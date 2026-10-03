/* Harici altyazi (SRT/VTT) cozumleyici + OpenSubtitles istemcisi testleri */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const APP = path.join(__dirname, '..');
const NL = String.fromCharCode(10);
const out = s => fs.writeSync(1, s + NL);
let pass = 0, fail = 0;
const chk = (t, ok, extra) => {
    if (ok) { pass++; out('PASS  ' + t + (extra ? ' :: ' + extra : '')); }
    else { fail++; out('FAIL  ' + t + (extra ? ' :: ' + extra : '')); process.exitCode = 1; }
};

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="overlay-root"></div></body></html>',
    { url: 'http://localhost/', runScripts: 'dangerously' });
const { window } = dom;
window.console.log = () => {}; window.console.warn = () => {}; window.console.error = () => {};

for (const f of ['js/core/polyfill.js', 'js/core/utils.js', 'js/core/logger.js', 'js/core/errors.js',
                 'js/core/events.js', 'js/core/storage.js', 'js/core/settings.js', 'js/core/cache.js',
                 'js/core/http.js', 'js/core/bigstore.js', 'js/core/keys.js',
                 'services/subtitles.js', 'services/opensubtitles.js']) {
    window.eval(fs.readFileSync(path.join(APP, f), 'utf8'));
}
const App = window.App;
const S = App.Subtitles;
const OS = App.OpenSubtitles;

/* ==================== SRT / VTT cozumleme ==================== */
const SRT = [
    '1',
    '00:00:01,000 --> 00:00:04,000',
    'Merhaba dunya',
    '',
    '2',
    '00:00:05,500 --> 00:00:08,250',
    'Iki satirli',
    'bir altyazi',
    '',
    '3',
    '00:01:00,000 --> 00:01:02,000',
    '<i>Egik yazi</i> ve {\\an8}konum komutu',
    ''
].join(NL);

const cues = S.parse(SRT);
chk('SRT: satir sayisi', cues.length === 3, cues.length);
chk('SRT: zaman cozumleme', cues[0].s === 1000 && cues[0].e === 4000,
    cues[0].s + '-' + cues[0].e);
chk('SRT: metin', cues[0].t === 'Merhaba dunya', JSON.stringify(cues[0].t));
chk('SRT: cok satirli korunur', cues[1].t === 'Iki satirli' + NL + 'bir altyazi',
    JSON.stringify(cues[1].t));
chk('SRT: saat basamagi', cues[2].s === 60000, cues[2].s);
chk('SRT: HTML ve ASS etiketleri temizlenir', cues[2].t === 'Egik yazi ve konum komutu',
    JSON.stringify(cues[2].t));

const VTT = [
    'WEBVTT',
    '',
    '00:00:02.000 --> 00:00:03.500 line:90%',
    'VTT satiri',
    ''
].join(NL);
const vcues = S.parse(VTT);
chk('VTT: nokta ayirici ve cue ayarlari', vcues.length === 1 &&
    vcues[0].s === 2000 && vcues[0].e === 3500 && vcues[0].t === 'VTT satiri',
    JSON.stringify(vcues[0]));

chk('bos girdi cokmez', S.parse('').length === 0 && S.parse(null).length === 0);
chk('bozuk girdi cokmez', S.parse('bu bir altyazi degil').length === 0);

/* ==================== Zaman cizelgesi ==================== */
S.load(SRT, { name: 'Test.srt', language: 'tr' });
chk('yukleme etkin', S.isActive() && S.count() === 3);
chk('baslangictan once bos', S.textAt(500) === '', JSON.stringify(S.textAt(500)));
chk('ilk satir', S.textAt(2000) === 'Merhaba dunya');
chk('satirlar arasi bosluk', S.textAt(4500) === '', JSON.stringify(S.textAt(4500)));
chk('ikinci satir', S.textAt(6000).indexOf('Iki satirli') === 0);
chk('ileri atlama (ikili arama)', S.textAt(61000) === 'Egik yazi ve konum komutu');
chk('geri atlama', S.textAt(2000) === 'Merhaba dunya');
chk('sondan sonra bos', S.textAt(999999) === '');

/* ARTI deger altyaziyi GECIKTIRIR: 1000-4000 araligi 2000-5000 olur */
S.setOffset(1000);
chk('+1sn altyaziyi geciktirir',
    S.textAt(1500) === '' && S.textAt(2500) === 'Merhaba dunya' && S.textAt(4500) === 'Merhaba dunya',
    'offset=' + S.getOffset());
/* EKSI deger ERKENE alir: 1000-4000 araligi 500-3500 olur */
S.setOffset(-500);
chk('-0.5sn altyaziyi erkene alir',
    S.textAt(600) === 'Merhaba dunya' && S.textAt(3800) === '',
    'offset=' + S.getOffset());
S.setOffset(0);

const info = S.info();
chk('bilgi dondurur', info && info.name === 'Test.srt' && info.count === 3, JSON.stringify(info));
S.clear();
chk('temizleme', !S.isActive() && S.textAt(2000) === '');

/* ==================== OpenSubtitles: baslik temizleme ==================== */
chk('baslik temizleme: kalite etiketleri',
    OS._cleanTitle('Kurulus.Osman.S03E12.1080p.WEB-DL.x264.TR') === 'Kurulus Osman S03E12',
    OS._cleanTitle('Kurulus.Osman.S03E12.1080p.WEB-DL.x264.TR'));
chk('baslik temizleme: yil parantezi',
    OS._cleanTitle('Inception (2010)') === 'Inception', OS._cleanTitle('Inception (2010)'));

/* ==================== queryFor ==================== */
const qEp = OS.queryFor({ type: 'episode', seriesName: 'Masumlar Apartmani', season: 2, episodeNum: 11 });
chk('bolum sorgusu', qEp.query === 'Masumlar Apartmani' && qEp.season === 2 && qEp.episode === 11,
    JSON.stringify(qEp));
/* Dizi adi YOKSA anlamsiz arama yapilmamali - gercek TV testinde
   "Bolum 1" ile arama yapiliyordu. */
const qNone = OS.queryFor({ type: 'episode', name: 'Bolum 1', season: 1, episodeNum: 1 });
chk('dizi adi yoksa arama reddedilir', qNone.query === '' && qNone.reason === 'noTitle',
    JSON.stringify(qNone));

const qFb = OS.queryFor({ type: 'episode', name: 'Bolum 1', season: 1, episodeNum: 1 },
                        'Kurulus Osman');
chk('baglamdan gelen dizi adi kullanilir', qFb.query === 'Kurulus Osman' && qFb.season === 1,
    JSON.stringify(qFb));

chk('bolum etiketi tespiti: Bolum 1', OS._isEpisodeLabelOnly('Bolum 1') === true);
chk('bolum etiketi tespiti: Bölüm 12', OS._isEpisodeLabelOnly('Bölüm 12') === true);
chk('bolum etiketi tespiti: S01E02', OS._isEpisodeLabelOnly('S01E02') === true);
chk('bolum etiketi tespiti: 5', OS._isEpisodeLabelOnly('5') === true);
chk('gercek dizi adi etiket sayilmaz', OS._isEpisodeLabelOnly('Kurulus Osman') === false);
chk('bolum basligi etiket sayilmaz', OS._isEpisodeLabelOnly('Kayip Sehir') === false);

const qMv = OS.queryFor({ type: 'movie', name: 'Inception (2010) 1080p' });
chk('film sorgusu yil ayirir', qMv.query === 'Inception' && qMv.year === 2010, JSON.stringify(qMv));
chk('canli yayinda sorgu yok', OS.queryFor({ type: 'live', name: 'TRT 1' }) === null);

/* ==================== Sonuc normalizasyonu ==================== */
const raw = {
    data: [
        { attributes: { language: 'tr', release: 'Makine cevirisi surumu', download_count: 5000,
                        ai_translated: true, files: [{ file_id: 11, file_name: 'a.srt' }],
                        feature_details: { season_number: 1, episode_number: 2 } } },
        { attributes: { language: 'tr', release: 'Guvenilir surum', download_count: 100,
                        from_trusted: true, files: [{ file_id: 22, file_name: 'b.srt' }],
                        feature_details: {} } },
        { attributes: { language: 'tr', release: 'Dosyasiz kayit', files: [] } }
    ]
};
const norm = OS._normalize(raw);
chk('dosyasiz kayit atilir', norm.length === 2, norm.length);
chk('guvenilir surum one alinir', norm[0].fileId === 22, norm.map(r => r.fileId).join(','));
chk('makine cevirisi isaretlenir', norm[1].aiTranslated === true);

/* ==================== Yapilandirma + sahte API ==================== */
chk('anahtarsiz yapilandirilmamis', OS.isConfigured() === false);

let lastReq = null;
const reqs = [];                 /* tum istekler - hangi ISTEGI dogruladigimiz onemli */
const lastReqTo = re => {        /* url'si kalibina uyan SON istek */
    for (let i = reqs.length - 1; i >= 0; i--) { if (re.test(reqs[i].url)) { return reqs[i]; } }
    return null;
};
function MockXHR() { this.headers = {}; }
MockXHR.prototype.open = function (m, u) { this._m = m; this._u = u; };
MockXHR.prototype.setRequestHeader = function (k, v) { this.headers[k] = v; };
MockXHR.prototype.abort = function () {};
MockXHR.prototype.send = function (body) {
    const self = this;
    lastReq = { method: this._m, url: this._u, headers: this.headers, body: body };
    reqs.push(lastReq);
    setTimeout(function () {
        self.status = 200;
        if (/\/login$/.test(self._u)) {
            self.responseText = JSON.stringify({ token: 'JETON123', user: { allowed_downloads: 100 } });
        } else if (/\/subtitles\?/.test(self._u)) {
            self.responseText = JSON.stringify(raw);
        } else if (/\/download$/.test(self._u)) {
            self.responseText = JSON.stringify({
                link: 'https://dl.example/altyazi.srt', file_name: 'altyazi.srt', remaining: 97
            });
        } else {
            self.responseText = SRT;      /* dosyanin kendisi */
        }
        if (self.onload) { self.onload(); }
    }, 3);
};
window.XMLHttpRequest = MockXHR;

OS.saveConfig({ apiKey: 'ANAHTAR', username: 'kullanici', password: 'sifre', language: 'tr' });
chk('yapilandirma kaydedildi', OS.isConfigured() && OS.hasAccount());
chk('sifre duz metin saklanmiyor',
    (window.localStorage.getItem('iptv.os.password') || '').indexOf('sifre') === -1,
    window.localStorage.getItem('iptv.os.password'));

(async function () {
    const results = await OS.search({ query: 'Test Dizi', season: 1, episode: 2 });
    chk('arama sonuc dondurur', results.length === 2, results.length);
    chk('arama Api-Key basligi gonderir', lastReq.headers['Api-Key'] === 'ANAHTAR',
        JSON.stringify(lastReq.headers['Api-Key']));
    chk('arama sezon/bolum parametreleri', /season_number=1/.test(lastReq.url) &&
        /episode_number=2/.test(lastReq.url), lastReq.url.split('?')[1]);
    chk('arama dil parametresi', /languages=tr/.test(lastReq.url));

    reqs.length = 0;
    const dl = await OS.download(22);
    chk('indirme metni getirir', dl.text.indexOf('Merhaba dunya') > -1);
    chk('kalan hak bildirilir', dl.remaining === 97, String(dl.remaining));

    const dlReq1 = lastReqTo(/\/download$/);
    chk('hesapli /download Bearer jeton gonderir',
        dlReq1 && dlReq1.headers['Authorization'] === 'Bearer JETON123',
        String(dlReq1 && dlReq1.headers['Authorization']));
    chk('hesapli iken /login cagrilir', lastReqTo(/\/login$/) !== null);

    const n = S.load(dl.text, { name: dl.fileName });
    chk('indirilen altyazi yuklenebiliyor', n === 3 && S.isActive(), n);
    S.clear();

    /* ---- HESAPSIZ INDIRME: yalnizca API anahtari yeterli olmali ---- */
    OS.saveConfig({ apiKey: 'ANAHTAR', username: '', password: '', language: 'tr' });
    chk('hesapsiz yapilandirma gecerli', OS.isConfigured() && !OS.hasAccount());

    reqs.length = 0;
    const dl2 = await OS.download(22);
    chk('hesapsiz indirme calisir', dl2.text.indexOf('Merhaba dunya') > -1);

    const dlReq = lastReqTo(/\/download$/);
    chk('/download istegi yapildi', !!dlReq, dlReq && dlReq.url);
    chk('hesapsiz /download Authorization GONDERMEZ',
        dlReq && dlReq.headers['Authorization'] === undefined,
        String(dlReq && dlReq.headers['Authorization']));
    chk('hesapsiz /download Api-Key gonderir',
        dlReq && dlReq.headers['Api-Key'] === 'ANAHTAR',
        String(dlReq && dlReq.headers['Api-Key']));
    chk('hesapsiz iken /login CAGRILMAZ', lastReqTo(/\/login$/) === null);

    /* Anahtar silinince arama reddedilmeli */
    OS.clearConfig();
    let rejected = false;
    try { await OS.search({ query: 'x' }); } catch (e) { rejected = !!e.code; }
    chk('anahtarsiz arama reddedilir', rejected);

    /* ==================== ALTYAZI ONBELLEGI ====================
       Indirilen altyazi cihazda saklanmali; ayni bolum tekrar acildiginda
       internete cikilmamali (OpenSubtitles gunluk hakki harcanmasin). */
    const SC = App.SubtitleCache;

    const epA = { type: 'episode', seriesName: 'Kurulus Osman', season: 2, episodeNum: 5 };
    const epB = { type: 'episode', seriesName: 'Kurulus Osman', season: 2, episodeNum: 6 };
    const epC = { type: 'episode', seriesName: 'Baska Dizi',    season: 2, episodeNum: 5 };
    const mv  = { type: 'movie',   name: 'Inception' };

    chk('anahtar uretilir (bolum)', !!SC.keyFor(epA, 'tr'), SC.keyFor(epA, 'tr'));
    chk('ayni bolum ayni anahtar', SC.keyFor(epA, 'tr') === SC.keyFor(epA, 'tr'));
    chk('farkli bolum farkli anahtar', SC.keyFor(epA, 'tr') !== SC.keyFor(epB, 'tr'));
    chk('farkli dizi farkli anahtar', SC.keyFor(epA, 'tr') !== SC.keyFor(epC, 'tr'));
    chk('farkli dil farkli anahtar', SC.keyFor(epA, 'tr') !== SC.keyFor(epA, 'en'));
    chk('anahtar uretilir (film)', !!SC.keyFor(mv, 'tr'), SC.keyFor(mv, 'tr'));
    chk('dizi adi yoksa anahtar yok',
        SC.keyFor({ type: 'episode', name: 'Bolum 1', season: 1, episodeNum: 1 }, 'tr') === null);
    chk('canli yayin icin anahtar yok', SC.keyFor({ type: 'live', name: 'TRT 1' }, 'tr') === null);

    chk('baslangicta kayitli degil', (await SC.has(epA, 'tr')) === false);

    await SC.put(epA, 'tr', { text: SRT, name: 'Kurulus.Osman.S02E05.srt', language: 'tr' });
    chk('onbellege yazildi', (await SC.has(epA, 'tr')) === true);

    const got2 = await SC.get(epA, 'tr');
    chk('onbellekten okunur', got2 && got2.text === SRT, got2 && got2.name);
    chk('okunan altyazi cozumlenebilir', App.Subtitles.parse(got2.text).length === 3);

    chk('yazilmayan bolum bos doner', (await SC.get(epB, 'tr')) === null);

    const st = SC.stats();
    chk('istatistik sayar', st.count === 1 && st.kb >= 0, JSON.stringify(st));

    await SC.remove(epA, 'tr');
    chk('tek kayit silinir', (await SC.has(epA, 'tr')) === false);

    await SC.put(epA, 'tr', { text: SRT, name: 'a' });
    await SC.put(epB, 'tr', { text: SRT, name: 'b' });
    chk('iki kayit var', SC.stats().count === 2, SC.stats().count);
    await SC.clear();
    chk('tumu temizlenir', SC.stats().count === 0 && (await SC.get(epA, 'tr')) === null);

    out(NL + '=== ' + pass + ' passed, ' + fail + ' failed ===');
    process.exit(fail ? 1 : 0);
})().catch(e => { out('CRASH: ' + e.stack); process.exit(1); });
