/* Spatial-navigation regression test using REAL login/home geometry.
   jsdom does no layout, so we feed exact rects the TV would produce at 1080p. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const APP = require('path').join(__dirname, '..');
const out = s => fs.writeSync(1, s + String.fromCharCode(10));
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
                 'js/core/http.js', 'js/core/keys.js', 'js/core/nav.js']) {
    window.eval(fs.readFileSync(path.join(APP, f), 'utf8'));
}
const App = window.App;

const RECTS = new Map();
window.Element.prototype.getBoundingClientRect = function () {
    const r = RECTS.get(this) || { left: 0, top: 0, width: 0, height: 0 };
    return { left: r.left, top: r.top, width: r.width, height: r.height,
             right: r.left + r.width, bottom: r.top + r.height };
};
Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', {
    get() { const r = RECTS.get(this); return r ? r.width : 0; } });
Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
    get() { const r = RECTS.get(this); return r ? r.height : 0; } });

const app = window.document.getElementById('app');
function box(name, left, top, width, height) {
    const el = window.document.createElement('div');
    el.setAttribute('data-focusable', '');
    el.setAttribute('data-name', name);
    RECTS.set(el, { left, top, width, height });
    app.appendChild(el);
    return el;
}
App.Nav.setScope(app);
const N = (el) => el && el.getAttribute('data-name');
function go(from, dir) { App.Nav.focus(from); App.Nav.move(dir); return N(App.Nav.get()); }

/* ---------------- LOGIN SCREEN (measured at 1920x1080) ----------------
   .login__card is 62rem wide (992px) centred; fields span the card. */
out('--- Giris ekrani (login) ---');
const tabX     = box('tabXtream',  468, 300, 480, 60);
const tabM     = box('tabM3U',     972, 300, 480, 60);
const fHost    = box('fieldHost',  468, 400, 984, 72);
const fUser    = box('fieldUser',  468, 512, 984, 72);
const fPass    = box('fieldPass',  468, 624, 984, 72);
const showPw   = box('showPass',   468, 730, 984, 56);
const btnConn  = box('btnConnect', 468, 830, 484, 64);
const btnHelp  = box('btnHelp',    968, 830, 484, 64);

chk('sekmeden ASAGI -> ilk metin kutusu (buton DEGIL)', go(tabX, 'down') === 'fieldHost', go(tabX, 'down'));
chk('sunucu -> kullanici adi', go(fHost, 'down') === 'fieldUser', go(fHost, 'down'));
chk('kullanici adi -> sifre',  go(fUser, 'down') === 'fieldPass', go(fUser, 'down'));
chk('sifre -> sifreyi goster', go(fPass, 'down') === 'showPass', go(fPass, 'down'));
chk('sifreyi goster -> Baglan', go(showPw, 'down') === 'btnConnect', go(showPw, 'down'));
chk('Baglan -> YUKARI -> sifreyi goster', go(btnConn, 'up') === 'showPass', go(btnConn, 'up'));
chk('sifre -> YUKARI -> kullanici adi', go(fPass, 'up') === 'fieldUser', go(fPass, 'up'));
chk('ilk metin kutusu -> YUKARI -> sekme', go(fHost, 'up') === 'tabXtream', go(fHost, 'up'));
chk('sekmeler arasi SAG', go(tabX, 'right') === 'tabM3U', go(tabX, 'right'));
chk('Baglan -> SAG -> Yardim', go(btnConn, 'right') === 'btnHelp', go(btnConn, 'right'));
chk('kutu icinde SAG hareketi kutudan cikmaz',
    ['fieldHost', undefined, null].indexOf(go(fHost, 'right')) > -1, String(go(fHost, 'right')));

/* ---------------- HOME: 4 kart / satir ---------------- */
out('--- Ana ekran (home) 7 kart, 4 sutun ---');
app.innerHTML = '';
RECTS.clear();
App.Nav.clear();
const cards = [];
const CW = 416, CH = 264, GAP = 24, X0 = 56, Y0 = 260;
for (let i = 0; i < 7; i++) {
    const col = i % 4, row = Math.floor(i / 4);
    cards.push(box('card' + i, X0 + col * (CW + GAP), Y0 + row * (CH + GAP), CW, CH));
}
chk('kart0 -> SAG -> kart1', go(cards[0], 'right') === 'card1', go(cards[0], 'right'));
chk('kart0 -> ASAGI -> kart4 (alt satir ayni sutun)', go(cards[0], 'down') === 'card4', go(cards[0], 'down'));
chk('kart1 -> ASAGI -> kart5', go(cards[1], 'down') === 'card5', go(cards[1], 'down'));
chk('kart3 -> ASAGI -> hizali yok, en yakina', go(cards[3], 'down') === 'card6', go(cards[3], 'down'));
chk('kart6 -> YUKARI -> kart2', go(cards[6], 'up') === 'card2', go(cards[6], 'up'));
chk('kart4 -> SOL -> hareket yok', go(cards[4], 'left') === 'card4', go(cards[4], 'left'));

/* ---------------- CANLI TV: 3 kolon ---------------- */
out('--- Canli TV 3 kolon ---');
app.innerHTML = '';
RECTS.clear();
App.Nav.clear();
const colCat  = box('kategoriler', 56, 200, 336, 800);
const colCh   = box('kanallar',   416, 200, 900, 800);
const colSide = box('epgPanel',  1340, 200, 524, 800);
chk('kategoriler -> SAG -> kanallar', go(colCat, 'right') === 'kanallar', go(colCat, 'right'));
chk('kanallar -> SOL -> kategoriler', go(colCh, 'left') === 'kategoriler', go(colCh, 'left'));
chk('kanallar -> SAG -> EPG paneli', go(colCh, 'right') === 'epgPanel', go(colCh, 'right'));

/* ---------------- AYARLAR: liste + yan panel ---------------- */
out('--- Ayarlar ---');
app.innerHTML = '';
RECTS.clear();
App.Nav.clear();
const sList = box('ayarListesi', 56, 200, 736, 800);
const sSide = box('yanPanel',   816, 200, 1048, 800);
chk('ayar listesi -> SAG -> yan panel', go(sList, 'right') === 'yanPanel', go(sList, 'right'));

out(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
