/* M3U dizi tespiti + grup sirasi testleri */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const APP = path.join(__dirname, '..');
const out = s => fs.writeSync(1, s + String.fromCharCode(10));
const NL = String.fromCharCode(10);
let pass = 0, fail = 0;
const chk = (t, ok, extra) => { if (ok) { pass++; out('PASS  ' + t + (extra ? ' :: ' + extra : '')); }
  else { fail++; out('FAIL  ' + t + (extra ? ' :: ' + extra : '')); process.exitCode = 1; } };

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="overlay-root"></div></body></html>',
  { url: 'http://localhost/', runScripts: 'dangerously' });
const { window } = dom;
window.console.log = () => {}; window.console.warn = () => {}; window.console.error = () => {};
for (const f of ['js/core/polyfill.js','js/core/utils.js','js/core/logger.js','js/core/errors.js',
                 'js/core/events.js','js/core/storage.js','js/core/settings.js','js/core/cache.js',
                 'js/core/http.js','js/core/bigstore.js','js/core/keys.js',
                 'services/profile.js','services/m3u.js',
                 'services/xtream.js','services/epg.js','services/content.js']) {
  window.eval(fs.readFileSync(path.join(APP, f), 'utf8'));
}
const App = window.App;

/* ---------- baslik kalibi tespiti ---------- */
const D = App.M3U.detectEpisode.bind(App.M3U);
const cases = [
  ['Kurulus Osman S01E05',            'Kurulus Osman', 1, 5],
  ['Kurulus Osman S02 E14',           'Kurulus Osman', 2, 14],
  ['Yalı Çapkını S1.E3',              'Yalı Çapkını', 1, 3],
  ['Breaking Bad 3x07',               'Breaking Bad', 3, 7],
  ['Masumlar Apartmanı Sezon 2 Bölüm 11', 'Masumlar Apartmanı', 2, 11],
  ['Dark Season 1 Episode 9',         'Dark', 1, 9],
  ['Bir Dizi - Bölüm 4',              'Bir Dizi', 1, 4],
  ['Teskilat S03 E22 - Son Görev',    'Teskilat', 3, 22]
];
for (const [name, series, s, e] of cases) {
  const r = D(name);
  chk('tespit: ' + name, !!r && r.series === series && r.season === s && r.episode === e,
      r ? `${r.series} S${r.season}E${r.episode}` : 'null');
}
chk('film yanlislikla dizi sayilmasin', D('Inception 2010') === null, JSON.stringify(D('Inception 2010')));
chk('4K etiketi bolum sanilmasin', D('Avatar 4K') === null, JSON.stringify(D('Avatar 4K')));
chk('bolum basligi ayrilir', D('Teskilat S03 E22 - Son Görev').title === 'Son Görev',
    D('Teskilat S03 E22 - Son Görev').title);

/* ---------- tam playlist ---------- */
const M3U = `#EXTM3U x-tvg-url="http://SERVER:PORT/xmltv.php"
#EXTINF:-1 tvg-logo="l1" group-title="TR ULUSAL",TRT 1
http://SERVER:PORT/live/U/P/1.ts
#EXTINF:-1 group-title="TR ULUSAL",Show TV
http://SERVER:PORT/live/U/P/2.ts
#EXTINF:-1 group-title="ALMANYA",RTL
http://SERVER:PORT/live/U/P/3.ts
#EXTINF:-1 group-title="TR SPOR",beIN Sports 1
http://SERVER:PORT/live/U/P/4.ts
#EXTINF:-1 group-title="FILMLER",Inception (2010)
http://SERVER:PORT/movie/U/P/50.mp4
#EXTINF:-1 tvg-logo="ko.png" group-title="TR DIZILER",Kurulus Osman S01 E01
http://SERVER:PORT/series/U/P/101.mp4
#EXTINF:-1 group-title="TR DIZILER",Kurulus Osman S01 E02
http://SERVER:PORT/series/U/P/102.mp4
#EXTINF:-1 group-title="TR DIZILER",Kurulus Osman S02 E01
http://SERVER:PORT/series/U/P/103.mp4
#EXTINF:-1 group-title="TR DIZILER",Masumlar Apartmanı Sezon 1 Bölüm 1
http://SERVER:PORT/series/U/P/201.mp4`;

App.M3U.parse(M3U).then(async d => {
  chk('toplam oge', d.items.length === 9, d.items.length);
  chk('canli kanal sayisi', d.items.filter(i => i.type === 'live').length === 4);
  chk('film sayisi (bolumler haric)', d.items.filter(i => i.type === 'movie').length === 1,
      d.items.filter(i => i.type === 'movie').map(i => i.name).join(','));
  chk('bolum sayisi', d.items.filter(i => i.type === 'episode').length === 4);
  chk('dizi sayisi', d.series.length === 2, d.series.map(s => s.name).join(' | '));

  const ko = d.series.find(s => s.name === 'Kurulus Osman');
  chk('dizi 2 sezonlu', ko && ko.seasons.length === 2, ko ? ko.seasons.length : 'yok');
  chk('sezon 1 iki bolum', ko && ko.seasons[0].episodes.length === 2);
  chk('dizi kapagi bolumden alindi', ko && ko.cover === 'ko.png', ko && ko.cover);
  chk('bolum adi', ko && ko.seasons[0].episodes[0].name === 'Bolum 1',
      ko && ko.seasons[0].episodes[0].name);

  /* GRUP SIRASI: playlistteki sirayla, alfabetik DEGIL */
  chk('grup sirasi korunur (TR en ustte)',
      d.groups.map(g => g.name).join('|') === 'TR ULUSAL|ALMANYA|TR SPOR|FILMLER|TR DIZILER',
      d.groups.map(g => g.name).join('|'));

  /* Content cephesi uzerinden */
  App.Profile.save({ type: 'm3u', m3uUrl: 'http://SERVER:PORT/get.php' });

  /* KOMPAKT ONBELLEK: pack/unpack tur atisi + boyut kazanci */
  const packed = App.M3U.pack(d);
  const rawSize = JSON.stringify(d).length;
  const packedSize = JSON.stringify(packed).length;
  chk('kompakt kodlama kucultuyor', packedSize < rawSize * 0.6,
      `${rawSize} -> ${packedSize} bayt (%${Math.round(packedSize*100/rawSize)})`);

  const back = App.M3U.unpack(packed);
  chk('unpack oge sayisi', back.items.length === d.items.length, back.items.length);
  chk('unpack dizileri yeniden kurar', back.series.length === d.series.length, back.series.length);
  chk('unpack grup sirasi korunur',
      back.groups.map(g => g.name).join('|') === d.groups.map(g => g.name).join('|'),
      back.groups.map(g => g.name).join('|'));
  chk('unpack kategori id kararli', back.items[0].categoryId === d.items[0].categoryId);
  chk('unpack anahtar kararli (favoriler bozulmaz)', back.items[0].key === d.items[0].key,
      back.items[0].key);
  chk('unpack bolum bilgisi', back.items.filter(i => i.type === 'episode').length === 4);

  App.Cache.set(App.Profile.key('m3u.packed'), packed, 60000, false);
  await App.Content.init();

  const liveCats = await App.Content.getLiveCategories();
  chk('canli kategoriler sirali', liveCats.map(c => c.name).join('|') === 'Tum Kanallar|TR ULUSAL|ALMANYA|TR SPOR',
      liveCats.map(c => c.name).join('|'));
  chk('dizi destegi acik (M3U)', App.Content.supports('series') === true);
  const sCats = await App.Content.getSeriesCategories();
  chk('dizi kategorisi', sCats.map(c => c.name).join('|') === 'Tum Diziler|TR DIZILER',
      sCats.map(c => c.name).join('|'));
  const sList = await App.Content.getSeriesList('__all__');
  chk('dizi listesi', sList.length === 2, sList.length);
  const info = await App.Content.getSeriesInfo(sList[0].id);
  chk('dizi detayi sezonlu', info.seasons.length === 2, info.seasons.length);
  const movies = await App.Content.getMovies('__all__');
  chk('Filmler bolumunde bolum YOK', movies.length === 1 && movies[0].name.indexOf('Inception') === 0,
      movies.map(m => m.name).join(','));
  chk('bolum stream url', App.Content.streamUrl(info.seasons[0].episodes[0]) ===
      'http://SERVER:PORT/series/U/P/101.mp4');

  /* ---------- GERCEKCI BUYUK PLAYLIST: depolama boyutu ----------
     Gercek Xtream M3U dosyalarinda her adres ayni uzun on ekle baslar;
     on ek sikistirmasinin asil kazanci burada gorulur. */
  const PREFIX = 'http://cok-uzun-sunucu-adresi.example:8080/live/kullaniciadi123/parola456789/';
  const LOGO   = 'http://cok-uzun-sunucu-adresi.example:8080/images/logos/kanallar/';
  let big = '#EXTM3U' + NL;
  for (let i = 1; i <= 5000; i++) {
    big += '#EXTINF:-1 tvg-id="ch' + i + '" tvg-logo="' + LOGO + i + '.png" group-title="Grup ' + (i % 40) + '",Kanal ' + i + NL;
    big += PREFIX + i + '.ts' + NL;
  }
  const bigParsed = await App.M3U.parse(big);
  const bigPacked = App.M3U.pack(bigParsed);
  const rawKB = Math.round(JSON.stringify(bigParsed).length / 1024);
  const packKB = Math.round(JSON.stringify(bigPacked).length / 1024);

  chk('5000 kanal cozumlendi', bigParsed.items.length === 5000, bigParsed.items.length);
  chk('on ek sikistirmasi calisiyor', bigPacked.up === PREFIX && bigPacked.lp === LOGO,
      'url on ek ' + bigPacked.up.length + ' / logo on ek ' + bigPacked.lp.length + ' karakter');
  chk('5000 kanal depolama boyutu makul', packKB < rawKB * 0.35,
      rawKB + ' KB -> ' + packKB + ' KB (%' + Math.round(packKB * 100 / rawKB) + ')');

  const bigBack = App.M3U.unpack(bigPacked);
  chk('buyuk liste tur atisi bozulmadan doner',
      bigBack.items.length === 5000 &&
      bigBack.items[4999].url === PREFIX + '5000.ts' &&
      bigBack.items[0].logo === LOGO + '1.png',
      bigBack.items[4999].url);

  /* ---------- BigStore (IndexedDB / localStorage yedegi) ---------- */
  chk('BigStore yedegi devrede (jsdom IndexedDB yok)',
      App.BigStore.backend() === 'localStorage', App.BigStore.backend());
  await App.BigStore.set('test.kv', { a: 1, b: 'iki' }, 60000);
  const got = await App.BigStore.get('test.kv');
  chk('BigStore yazip okuyabiliyor', got && got.a === 1 && got.b === 'iki', JSON.stringify(got));
  await App.BigStore.remove('test.kv');
  const gone = await App.BigStore.get('test.kv');
  chk('BigStore silebiliyor', gone === undefined, String(gone));
  await App.BigStore.set('test.exp', 'x', -1);
  const expired = await App.BigStore.get('test.exp');
  chk('BigStore suresi dolani dondurmuyor', expired === undefined, String(expired));

  out(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
}).catch(e => { out('CRASH: ' + e.stack); process.exit(1); });
