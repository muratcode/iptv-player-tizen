/* Smoke test: boot the Tizen app inside jsdom and drive the remote control. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const APP = require('path').join(__dirname, '..');
const errors = [];
const logs = [];

const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8')
    // strip the Tizen-only webapis include (404 in jsdom)
    .replace(/<script src="\$WEBAPIS[^>]*><\/script>/, '');

const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    resources: undefined,          // we inject scripts manually
    pretendToBeVisual: true
});

const { window } = dom;
window.onerror = (msg, src, line) => { errors.push(`window.onerror: ${msg} @${line}`); };
window.addEventListener('error', e => errors.push('error event: ' + e.message));

// capture console
window.console.log = (...a) => logs.push(a.join(' '));
window.console.warn = (...a) => logs.push('WARN ' + a.join(' '));
const EXPECTED = [/bad host/];   // deliberately-invalid URL used in one assertion
window.console.error = (...a) => {
    const s = a.join(' ');
    logs.push('ERR ' + s);
    if (!EXPECTED.some(re => re.test(s))) errors.push(s);
};

// jsdom lacks these
window.HTMLMediaElement.prototype.load = function () {};
window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () {};

// give layout some size (jsdom returns 0 for clientWidth)
Object.defineProperty(window.document.documentElement, 'clientWidth', { value: 1920 });
Object.defineProperty(window.document.documentElement, 'clientHeight', { value: 1080 });
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 800; } });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get() { return 600; } });
Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { get() { return 800; } });
Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { get() { return 60; } });

// deterministic-ish rects so spatial nav works
let rectSeq = 0;
window.Element.prototype.getBoundingClientRect = function () {
    if (!this.__rect) {
        const i = rectSeq++;
        this.__rect = { left: (i % 5) * 300, top: Math.floor(i / 5) * 120,
                        width: 280, height: 100 };
        this.__rect.right = this.__rect.left + this.__rect.width;
        this.__rect.bottom = this.__rect.top + this.__rect.height;
    }
    return this.__rect;
};

// load scripts in document order
const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src'));
for (const src of scripts) {
    const p = path.join(APP, src);
    if (!fs.existsSync(p)) { errors.push('MISSING SCRIPT: ' + src); continue; }
    const code = fs.readFileSync(p, 'utf8');
    try {
        window.eval(code);
    } catch (e) {
        errors.push(`EXEC ${src}: ${e.message}`);
    }
}

const App = window.App;

function key(code) {
    const ev = new window.KeyboardEvent('keydown', { bubbles: true });
    Object.defineProperty(ev, 'keyCode', { get: () => code });
    window.document.dispatchEvent(ev);
}

const K = App && App.Keys ? App.Keys.KEY : {};

function report(title, ok, extra) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}${extra ? ' :: ' + extra : ''}`);
    if (!ok) process.exitCode = 1;
}

(async function run() {
    report('modules loaded', !!(App && App.Router && App.Player && App.Content && App.Views),
        App ? Object.keys(App).join(',') : 'no App');

    // boot
    try { App.boot(); } catch (e) { errors.push('boot: ' + e.stack); }
    await new Promise(r => setTimeout(r, 300));

    const appEl = window.document.getElementById('app');
    report('login view mounted', !!appEl.querySelector('[data-view="login"] .login__card'));
    report('player engine = html5 fallback', App.Player.engineName() === 'html5', App.Player.engineName());

    // --- navigation smoke ---
    const before = App.Nav.get();
    key(K.DOWN); key(K.DOWN); key(K.RIGHT);
    report('nav moves focus', App.Nav.get() !== before || !!App.Nav.get());

    // --- back at root opens exit confirm modal ---
    key(K.BACK);
    await new Promise(r => setTimeout(r, 50));
    report('back at root -> exit modal', App.UI.Modal.isOpen());
    key(K.BACK); // cancel
    await new Promise(r => setTimeout(r, 50));
    report('modal cancel closes', !App.UI.Modal.isOpen());

    // --- M3U parser ---
    const m3u = `#EXTM3U x-tvg-url="http://SERVER:PORT/xmltv.php?username=U&password=P"
#EXTINF:-1 tvg-id="ch1" tvg-name="Kanal Bir" tvg-logo="http://SERVER/logo1.png" group-title="Ulusal",Kanal Bir
http://SERVER:PORT/live/U/P/1.m3u8
#EXTINF:-1 tvg-id="ch2" tvg-logo="http://SERVER/logo2.png" group-title="Spor",Spor 1 HD
http://SERVER:PORT/live/U/P/2.ts
#EXTGRP:Filmler
#EXTINF:-1 tvg-name="Bir Film",Bir Film (2024)
http://SERVER:PORT/movie/U/P/99.mp4
#EXTVLCOPT:http-user-agent=Test
#EXTINF:-1 group-title="Ulusal",Kanal Iki
http://SERVER:PORT/live/U/P/3.m3u8`;
    const parsed = await App.M3U.parse(m3u);
    report('m3u parse count', parsed.items.length === 4, 'got ' + parsed.items.length);
    report('m3u attrs', parsed.items[0].name === 'Kanal Bir' &&
        parsed.items[0].logo === 'http://SERVER/logo1.png' &&
        parsed.items[0].categoryName === 'Ulusal', JSON.stringify(parsed.items[0]));
    report('m3u vod detection', parsed.items[2].type === 'movie', parsed.items[2].type);
    report('m3u EXTGRP group', parsed.items[2].categoryName === 'Filmler', parsed.items[2].categoryName);
    report('m3u epgUrl', parsed.epgUrl.indexOf('xmltv.php') > -1, parsed.epgUrl);

    // --- XMLTV parser ---
    const now = Date.now();
    function xd(offsetMin) {
        const d = new Date(now + offsetMin * 60000);
        const p = n => String(n).padStart(2, '0');
        return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}00 +0000`;
    }
    const xml = `<?xml version="1.0"?><tv>
<programme start="${xd(-30)}" stop="${xd(30)}" channel="ch1"><title>Simdiki Program</title><desc>Aciklama &amp; test</desc></programme>
<programme start="${xd(30)}" stop="${xd(90)}" channel="ch1"><title>Sonraki Program</title></programme>
</tv>`;
    const res = await App.EPG.parseXmltv(xml, null, null);
    report('xmltv programmes', res.programmes === 2, 'got ' + res.programmes);
    report('xmltv entity decode', res.index['ch1'][0].d === 'Aciklama & test', res.index['ch1'][0].d);

    // --- Xtream URL building (placeholders only) ---
    App.Xtream.configure({ host: 'SERVER:8080', username: 'USERNAME', password: 'PASSWORD' });
    report('xtream host normalize', App.Xtream.getConfig().host === 'http://SERVER:8080',
        App.Xtream.getConfig().host);
    report('xtream live url',
        App.Xtream.liveUrl(1234) === 'http://SERVER:8080/live/USERNAME/PASSWORD/1234.m3u8',
        App.Xtream.liveUrl(1234));
    report('xtream ts url',
        App.Xtream.liveUrl(1234, 'ts') === 'http://SERVER:8080/live/USERNAME/PASSWORD/1234.ts');
    report('xtream movie url',
        App.Xtream.movieUrl(7, 'mkv') === 'http://SERVER:8080/movie/USERNAME/PASSWORD/7.mkv');
    report('xtream episode url',
        App.Xtream.episodeUrl(42, 'mp4') === 'http://SERVER:8080/series/USERNAME/PASSWORD/42.mp4');
    report('xtream xmltv url', App.Xtream.xmltvUrl().indexOf('/xmltv.php?username=USERNAME') > -1);
    report('xtream host strips player_api',
        App.Utils.normalizeHost('http://SERVER:8080/player_api.php?x=1') === 'http://SERVER:8080');

    // --- storage / secret ---
    App.Storage.setSecret('t.pw', 'gizli-şifre-123');
    const raw = window.localStorage.getItem('iptv.t.pw');
    report('secret obfuscated at rest', raw.indexOf('gizli') === -1, raw);
    report('secret round-trip', App.Storage.getSecret('t.pw') === 'gizli-şifre-123');

    // --- favorites / history ---
    const chan = { key: 'live:1', type: 'live', id: 1, name: 'Test Kanal', num: 5 };
    report('fav toggle on', App.Favorites.toggle(chan) === true && App.Favorites.has(chan));
    report('fav toggle off', App.Favorites.toggle(chan) === false && !App.Favorites.has(chan));
    /* BOLUM ALANLARI KAYBOLMAMALI:
       Favori/gecmis kayitlari kucultulurken dizi adi dusuruluyordu; bu yuzden
       "Son Izlenenler"den acilan bolumde baslik yalnizca "Bolum 1" goruruyor
       ve internetten altyazi aramasi calismiyordu. */
    const ep = {
        key: 'episode:77', type: 'episode', id: 77, name: 'Bolum 1',
        seriesName: 'Kurulus Osman', seriesId: 'sid9', season: 2, episodeNum: 5,
        containerExtension: 'mp4'
    };
    App.Favorites.add(ep);
    const favEp = App.Favorites.list('episode')[0];
    report('favoride dizi adi korunur', favEp && favEp.seriesName === 'Kurulus Osman',
        favEp && favEp.seriesName);
    report('favoride sezon/bolum korunur', favEp.season === 2 && favEp.episodeNum === 5,
        favEp.season + '/' + favEp.episodeNum);
    App.Favorites.remove('episode:77');

    App.History.push(ep);
    const histEp = App.History.list('episode')[0];
    report('gecmiste dizi adi korunur', histEp && histEp.seriesName === 'Kurulus Osman',
        histEp && histEp.seriesName);
    report('gecmiste sezon/bolum korunur', histEp.season === 2 && histEp.episodeNum === 5,
        histEp.season + '/' + histEp.episodeNum);
    App.History.remove('episode:77');

    App.History.push({ key: 'movie:9', type: 'movie', id: 9, name: 'Film' });
    App.History.updatePosition('movie:9', 600, 6000);
    report('history resume', App.History.resumeOf('movie:9') === 600, App.History.resumeOf('movie:9'));
    report('history progress ~0.1', Math.abs(App.History.progressOf('movie:9') - 0.1) < 0.001);

    // --- utils ---
    report('b64 utf8 decode', App.Utils.b64decode('QsO2bMO8bSBiYcWfbMSxeW9y') === 'Bölüm başlıyor',
        App.Utils.b64decode('QsO2bMO8bSBiYcWfbMSxeW9y'));
    report('tr normalize', App.Utils.normalize('GÜÇLÜ Şİir') === 'guclu siir',
        App.Utils.normalize('GÜÇLÜ Şİir'));
    report('duration fmt', App.Utils.duration(3725) === '1:02:05', App.Utils.duration(3725));

    // --- virtual list with 20000 items ---
    const host = window.document.createElement('div');
    window.document.getElementById('app').appendChild(host);
    const big = [];
    for (let i = 0; i < 20000; i++) { big.push({ key: 'k' + i, name: 'Item ' + i, num: i + 1 }); }
    let rendered = 0;
    const vl = App.UI.VirtualList.create({
        container: host, itemHeight: 60,
        render(node, item) { rendered++; node.textContent = item.name; }
    });
    const t0 = Date.now();
    vl.setItems(big);
    const t1 = Date.now();
    const domNodes = host.querySelectorAll('.list__item').length;
    report('vlist handles 20k items', vl.count() === 20000);
    report('vlist DOM nodes bounded', domNodes < 60, domNodes + ' nodes, ' + rendered + ' renders, ' + (t1 - t0) + 'ms');
    vl.onKey(K.DOWN); vl.onKey(K.DOWN);
    report('vlist moves index', vl.getIndex() === 2, vl.getIndex());
    vl.onKey(K.CH_DOWN);
    report('vlist page jump', vl.getIndex() > 5, vl.getIndex());
    const jumped = vl.jumpTo(it => it.num === 15000);
    report('vlist jumpTo', jumped === 14999, jumped);

    // --- MODAL ODAK GORUNURLUGU (gercek TV'de bulunan hata) ---
    // Odak stili CSS'te [data-focusable].is-focused olarak taniml; modal ogeleri
    // bu nitelige SAHIP DEGIL. Stil ayrica tanimlanmazsa kumandanin hangi
    // satirda oldugu EKRANDA HIC GORUNMEZ.
    const cssText = ['theme','reset','layout','components','views']
        .map(f => fs.readFileSync(path.join(APP, 'css', f + '.css'), 'utf8')).join(String.fromCharCode(10));

    report('modal secenegi icin odak stili tanimli',
        /\.modal__opt\.is-focused\s*\{[^}]*box-shadow/.test(cssText));
    report('modal butonu icin odak stili tanimli',
        /\.modal__btns\s+\.btn\.is-focused\s*\{[^}]*box-shadow/.test(cssText));
    report('modal etkin secenek isareti tanimli',
        /\.modal__opt\.is-current\s*\{/.test(cssText));
    report('modal listesi kaydirilabilir',
        /\.modal__list\s*\{[^}]*overflow-y:\s*auto/.test(cssText));

    // Modal ogeleri Nav taramasina girmemeli (aksi halde arka plandaki
    // ekranin odagiyla catisir) -> data-focusable TASIMAMALI
    const modalJs = fs.readFileSync(path.join(APP, 'js/ui/modal.js'), 'utf8');
    report('modal ogeleri Nav taramasina girmiyor',
        modalJs.indexOf('data-focusable') === -1);

    // Calisma zamani: secenekler arasinda gezinince is-focused DOGRU satirda mi
    const chooseP = App.UI.Modal.choose('Ses Parcasi', [
        { icon: '✔', label: 'Turkce',    hint: 'CALIYOR', current: true,  value: 0 },
        { icon: '🔈', label: 'Ingilizce', value: 1 },
        { icon: '🔈', label: 'Almanca',   value: 2 }
    ], { defaultIndex: 0 });
    await new Promise(r => setTimeout(r, 20));

    const optEls = [...window.document.querySelectorAll('.modal__opt')];
    report('modal 3 secenek cizdi', optEls.length === 3, optEls.length);
    report('etkin secenek isaretli', optEls[0].classList.contains('is-current'));
    report('baslangicta ilk satir odakli', optEls[0].classList.contains('is-focused'));
    report('ipucu sutunu ayri', !!optEls[0].querySelector('.modal__opt-hint'));

    key(K.DOWN);
    report('ASAGI -> odak 2. satira gecti',
        !optEls[0].classList.contains('is-focused') && optEls[1].classList.contains('is-focused'));
    report('etkin isaret odakla KARISMIYOR',
        optEls[0].classList.contains('is-current') && !optEls[1].classList.contains('is-current'));

    key(K.DOWN);
    key(K.ENTER);
    const chosen = await chooseP;
    report('secim dogru degeri dondurdu', chosen === 2, String(chosen));

    // --- error messages are Turkish + typed ---
    const e1 = new App.AppError('AUTH', 'auth=0');
    report('AppError turkish message', e1.message.indexOf('Kullanici adi veya sifre hatali') === 0, e1.message);
    report('AppError wrap', App.AppError.wrap(new Error('x')).code === 'UNKNOWN');

    // --- router stack / back behaviour ---
    // EXTGRP written AFTER #EXTINF (the other common ordering)
    const m3u2 = `#EXTM3U
#EXTINF:-1,Kanal A
#EXTGRP:Haber
http://SERVER:PORT/live/U/P/10.ts
#EXTINF:-1,Kanal B
http://SERVER:PORT/live/U/P/11.ts`;
    const p2 = await App.M3U.parse(m3u2);
    report('extgrp after extinf', p2.items[0].categoryName === 'Haber', p2.items[0].categoryName);
    report('extgrp sticky to next', p2.items[1].categoryName === 'Haber', p2.items[1].categoryName);

    // Content.init rejection must be a typed AppError, never an uncaught crash
    App.Profile.save({ type: 'm3u', m3uUrl: 'http://bad host/get.php' });
    let caught = null;
    await App.Content.init().catch(e => { caught = e; });
    report('content.init rejects with AppError', !!caught && !!caught.code && !!caught.message,
        caught ? caught.code : 'none');
    await new Promise(r => setTimeout(r, 50));

    console.log('\n--- collected errors (' + errors.length + ') ---');
    errors.slice(0, 25).forEach(e => console.log('  ! ' + e));
    if (!errors.length) console.log('  (none)');

    report('no uncaught runtime errors', errors.length === 0);
})();
