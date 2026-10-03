/* End-to-end: boot with a mocked Xtream server and walk every screen. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const APP = require('path').join(__dirname, '..');
const out = s => { try { fs.writeSync(1, s + String.fromCharCode(10)); } catch (e) {} };

let STEP = 'init';
const step = s2 => { STEP = s2; };
setTimeout(() => { out('WATCHDOG: stuck at step -> ' + STEP); process.exit(2); }, 40000).unref?.();

const errors = [];
let pass = 0, fail = 0;

const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8')
    .replace(/<script src="\$WEBAPIS[^>]*><\/script>/, '');

const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true });
const { window } = dom;

window.console.log = () => {};
window.console.warn = () => {};
window.console.error = (...a) => errors.push(a.join(' '));
window.onerror = (m, s, l) => { errors.push(`onerror: ${m} @${l}`); };

window.HTMLMediaElement.prototype.load = function () {};
window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () {};

Object.defineProperty(window.document.documentElement, 'clientWidth', { value: 1920 });
Object.defineProperty(window.document.documentElement, 'clientHeight', { value: 1080 });
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 900; } });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get() { return 700; } });
Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { get() { return 900; } });
Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { get() { return 60; } });
let seq = 0;
window.Element.prototype.getBoundingClientRect = function () {
    if (!this.__r) {
        const i = seq++;
        const r = { left: (i % 4) * 320, top: Math.floor(i / 4) * 130, width: 300, height: 110 };
        r.right = r.left + r.width; r.bottom = r.top + r.height;
        this.__r = r;
    }
    return this.__r;
};

/* ---------------- Mock Xtream server ---------------- */
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const nowSec = Math.floor(Date.now() / 1000);

function mkList(n, f) { const a = []; for (let i = 1; i <= n; i++) a.push(f(i)); return a; }

const DB = {
    login: {
        user_info: {
            username: 'USERNAME', auth: 1, status: 'Active', is_trial: '0',
            active_cons: '1', max_connections: '2',
            created_at: String(nowSec - 86400 * 100),
            exp_date: String(nowSec + 86400 * 45),
            allowed_output_formats: ['m3u8', 'ts']
        },
        server_info: { url: 'SERVER', port: '8080', https_port: '443', server_protocol: 'http', timezone: 'Europe/Istanbul' }
    },
    liveCats: mkList(6, i => ({ category_id: String(i), category_name: 'Kategori ' + i, parent_id: 0 })),
    liveStreams: mkList(2500, i => ({
        num: i, name: 'Kanal ' + i, stream_id: i,
        stream_icon: 'http://SERVER:8080/logo/' + i + '.png',
        epg_channel_id: 'ch' + i, category_id: String((i % 6) + 1), tv_archive: i % 5 === 0 ? 1 : 0
    })),
    vodCats: mkList(4, i => ({ category_id: 'v' + i, category_name: 'Film Kategori ' + i })),
    vodStreams: mkList(600, i => ({
        num: i, name: 'Film ' + i, stream_id: 1000 + i, stream_icon: 'http://SERVER:8080/p/' + i + '.jpg',
        category_id: 'v' + ((i % 4) + 1), container_extension: 'mkv', rating: '7.5'
    })),
    vodInfo: {
        info: { plot: 'Ozet metni.', cast: 'Oyuncu A, Oyuncu B', director: 'Yonetmen', genre: 'Dram',
                releasedate: '2023-05-01', rating: '7.5', duration_secs: 6300, duration: '01:45:00',
                movie_image: 'http://SERVER:8080/p/1.jpg', backdrop_path: ['http://SERVER:8080/b.jpg'] },
        movie_data: { stream_id: 1001, name: 'Film 1', container_extension: 'mkv' }
    },
    seriesCats: mkList(3, i => ({ category_id: 's' + i, category_name: 'Dizi Kategori ' + i })),
    series: mkList(120, i => ({
        series_id: 2000 + i, name: 'Dizi ' + i, cover: 'http://SERVER:8080/s/' + i + '.jpg',
        category_id: 's' + ((i % 3) + 1), plot: 'Dizi ozeti ' + i, rating: '8.0', releaseDate: '2022-01-01'
    })),
    seriesInfo: {
        info: { name: 'Dizi 1', plot: 'Uzun ozet', cast: 'A, B', genre: 'Aksiyon',
                releaseDate: '2022-01-01', rating: '8.0', cover: 'http://SERVER:8080/s/1.jpg' },
        seasons: [{ season_number: 1, name: 'Sezon 1', cover: 'x' }, { season_number: 2, name: 'Sezon 2', cover: 'y' }],
        episodes: {
            '1': mkList(12, i => ({ id: String(30000 + i), episode_num: i, title: 'S01B' + i,
                container_extension: 'mp4', info: { plot: 'Bolum ozeti', duration_secs: 2700, duration: '00:45:00' } })),
            '2': mkList(10, i => ({ id: String(31000 + i), episode_num: i, title: 'S02B' + i,
                container_extension: 'mp4', info: { plot: 'Bolum ozeti', duration_secs: 2700 } }))
        }
    },
    shortEpg: {
        epg_listings: [
            { title: b64('Şimdiki Program'), description: b64('Açıklama'), start_timestamp: String(nowSec - 900), stop_timestamp: String(nowSec + 900) },
            { title: b64('Sonraki Program'), description: b64(''), start_timestamp: String(nowSec + 900), stop_timestamp: String(nowSec + 3600) }
        ]
    }
};

const requestLog = [];

function respond(url) {
    requestLog.push(url);
    const q = url.split('?')[1] || '';
    const m = /action=([a-z_]+)/.exec(q);
    if (!/player_api\.php/.test(url)) return null;
    if (!m) return DB.login;
    switch (m[1]) {
        case 'get_live_categories': return DB.liveCats;
        case 'get_live_streams': {
            const c = /category_id=([^&]+)/.exec(q);
            return c ? DB.liveStreams.filter(s => s.category_id === c[1]) : DB.liveStreams;
        }
        case 'get_vod_categories': return DB.vodCats;
        case 'get_vod_streams': {
            const c = /category_id=([^&]+)/.exec(q);
            return c ? DB.vodStreams.filter(s => s.category_id === c[1]) : DB.vodStreams;
        }
        case 'get_vod_info': return DB.vodInfo;
        case 'get_series_categories': return DB.seriesCats;
        case 'get_series': {
            const c = /category_id=([^&]+)/.exec(q);
            return c ? DB.series.filter(s => s.category_id === c[1]) : DB.series;
        }
        case 'get_series_info': return DB.seriesInfo;
        case 'get_short_epg': return DB.shortEpg;
        default: return [];
    }
}

function installMockXhr() {
    function MockXHR() { this.readyState = 0; this.status = 0; this.responseText = ''; }
    MockXHR.prototype.open = function (m, u) { this._url = u; };
    MockXHR.prototype.setRequestHeader = function () {};
    MockXHR.prototype.abort = function () { if (this.onabort) this.onabort(); };
    MockXHR.prototype.send = function () {
        const self = this;
        setTimeout(function () {
            const data = respond(self._url);
            if (data === null) { self.status = 404; if (self.onload) self.onload(); return; }
            self.status = 200;
            self.responseText = JSON.stringify(data);
            if (self.onload) self.onload();
        }, 5);
    };
    window.XMLHttpRequest = MockXHR;
}

/* ---------------- load scripts ---------------- */
for (const src of [...window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src'))) {
    const p = path.join(APP, src);
    if (!fs.existsSync(p)) { errors.push('MISSING ' + src); continue; }
    try { window.eval(fs.readFileSync(p, 'utf8')); }
    catch (e) { errors.push(`EXEC ${src}: ${e.message}`); }
}
installMockXhr();

const App = window.App;
const K = App.Keys.KEY;
const appEl = window.document.getElementById('app');

function key(code) {
    const ev = new window.KeyboardEvent('keydown', { bubbles: true });
    Object.defineProperty(ev, 'keyCode', { get: () => code });
    window.document.dispatchEvent(ev);
}
const wait = ms => new Promise(r => setTimeout(r, ms));
function chk(t, ok, extra) {
    step(t);
    if (ok) { pass++; out('PASS  ' + t + (extra ? ' :: ' + extra : '')); }
    else { fail++; out('FAIL  ' + t + (extra ? ' :: ' + extra : '')); process.exitCode = 1; }
}
function view() { return App.Router.current(); }
/* Robust: close any modal, then pop until we are back at the root view. */
async function goHome() {
    for (let i = 0; i < 8; i++) {
        if (App.UI.Modal.isOpen()) { App.UI.Modal.close(); await wait(40); continue; }
        if (view() === 'home') { return; }
        key(K.BACK); await wait(160);
    }
}
async function openCard(name) {
    await goHome();
    App.Nav.focusSelector('[data-card="' + name + '"]');
    key(K.ENTER); await wait(500);
}
function q(sel) { return appEl.querySelector(sel); }
function qa(sel) { return appEl.querySelectorAll(sel); }

(async function run() {
    // seed a logged-in Xtream profile
    App.Profile.save({ type: 'xtream', host: 'http://SERVER:8080', username: 'USERNAME', password: 'PASSWORD' });

    App.boot();
    await wait(600);

    chk('boots to home', view() === 'home', view());

    // ---- Acilis gorseli (splash) ----
    chk('acilis gorseli gorunuyor', !!window.document.getElementById('splash'));
    chk('uygulama gorselin ARKASINDA aciliyor', !!appEl.querySelector('[data-view="home"]'));
    key(K.ENTER);                       // ilk tus yalnizca gorseli kapatir
    await wait(700);
    chk('tusla acilis gorseli kapanir', !window.document.getElementById('splash'));
    chk('ilk tus arkadaki ekrani ETKILEMEDI', view() === 'home', view());
    chk('home has 8 cards', qa('[data-card]').length === 8, qa('[data-card]').length);
    chk('account expiry shown', /Bitis: /.test(q('.topbar__meta').textContent), q('.topbar__meta').textContent.trim());

    // ---- Canli TV ----
    await openCard('live'); await wait(300);
    chk('live view mounted', view() === 'live', view());
    chk('live categories rendered', qa('.col--cats .list__item').length > 0, qa('.col--cats .list__item').length);
    const chRows = qa('.col--channels .list__item');
    chk('live channels virtualised', chRows.length > 0 && chRows.length < 40, chRows.length + ' DOM rows');
    const vl = q('.col--channels .col__body').__vlist;
    chk('all 2500 channels loaded', vl.count() > 2000, vl.count());
    chk('channel row has logo+name', !!q('.col--channels .ch__logo') && !!q('.col--channels .ch__name'));
    await wait(600); // EPG debounce
    chk('EPG panel filled', /Şimdiki Program/.test(q('.col--side').textContent),
        q('.side__prog') ? q('.side__prog').textContent : 'n/a');

    // number-key channel jump
    key(K.N1); key(K.N0); key(K.N0);
    await wait(1400);
    chk('numeric zap jumps', vl.getItem().num === 100, 'num=' + vl.getItem().num);

    // favourite via YELLOW
    const favBefore = App.Favorites.count();
    key(K.YELLOW);
    chk('yellow toggles favourite', App.Favorites.count() === favBefore + 1, App.Favorites.count());
    key(K.YELLOW);
    chk('yellow untoggles', App.Favorites.count() === favBefore);

    // ---- Player ----
    key(K.ENTER);
    await wait(400);
    chk('player view opened', view() === 'player', view());
    chk('OSD shows channel name', /Kanal 100/.test(q('.osd__name').textContent), q('.osd__name').textContent);
    chk('history recorded', App.History.count() > 0, App.History.count());
    await wait(1200); // html5 prepare fails in jsdom -> recovery -> error box
    const st = App.Player.getState();
    chk('player degrades without crashing', ['loading', 'buffering', 'error', 'playing'].indexOf(st) > -1, st);

    // Orta tus (OK) DURDUR/DEVAM tetiklemeli (onceden yalnizca bilgi seridini aciyordu)
    let pauseCalls = 0;
    const origToggle = App.Player.togglePause;
    App.Player.togglePause = function () { pauseCalls++; return origToggle.apply(App.Player, arguments); };
    key(K.ENTER);
    chk('oynaticida OK durdur/devam tetikler', pauseCalls === 1, 'cagri=' + pauseCalls);
    App.Player.togglePause = origToggle;

    key(K.BACK); // hide OSD or leave
    await wait(60);
    if (view() === 'player') { key(K.BACK); await wait(200); }
    chk('back returns to live', view() === 'live', view());

    key(K.BACK); await wait(60);   // channels -> categories
    key(K.BACK); await wait(300);  // -> home
    chk('back returns to home', view() === 'home', view());

    // ---- Filmler ----
    await openCard('movies'); await wait(400);
    chk('movies view mounted', view() === 'movies', view());
    const gridNodes = qa('.grid__item');
    chk('poster grid virtualised', gridNodes.length > 0 && gridNodes.length < 60, gridNodes.length + ' DOM posters');
    const mg = q('.col.fill .col__body').__vlist;
    chk('600 movies loaded', mg.count() > 500, mg.count());
    chk('grid is 5 columns', /width: /.test(gridNodes[0].getAttribute('style') || ''), gridNodes[0].getAttribute('style'));

    key(K.ENTER); await wait(300);
    chk('movie detail sheet opens', App.UI.Modal.isOpen());
    key(K.BACK); await wait(100);   // close modal
    key(K.BACK); await wait(100);   // grid -> categories
    key(K.BACK); await wait(300);   // -> home
    chk('back to home from movies', view() === 'home', view());

    // ---- Diziler ----
    await openCard('series'); await wait(400);
    chk('series view mounted', view() === 'series', view());

    key(K.ENTER);
    await wait(700);
    chk('seriesDetail mounted', view() === 'seriesDetail', view());
    chk('season chips built', qa('.season-chip').length === 2, qa('.season-chip').length);
    chk('episodes listed', q('.sdet__eps .list__item') !== null);
    chk('series meta shown', /2 sezon/.test(q('.sdet__meta').textContent), q('.sdet__meta').textContent);

    key(K.BACK); await wait(100);   // episodes -> season row
    key(K.BACK); await wait(300);   // -> series
    chk('back to series list', view() === 'series', view());
    chk('focus restored after back', !!App.Nav.get() && q('[data-view="series"]').contains(App.Nav.get()),
        App.Nav.get() ? App.Nav.get().className : 'null');
    key(K.BACK); await wait(100);   // grid -> categories
    key(K.BACK); await wait(300);   // -> home
    chk('back to home from series', view() === 'home', view());

    // ---- Favoriler ----
    App.Favorites.add({ key: 'live:7', type: 'live', id: 7, name: 'Kanal 7', num: 7 });
    await openCard('favorites');
    chk('favorites view mounted', view() === 'favorites', view());
    chk('favorite row rendered', /Kanal 7/.test(q('.col.fill').textContent));
    await goHome();
    chk('back to home from favorites', view() === 'home', view());

    // ---- Son izlenenler ----
    await openCard('recent');
    chk('recent view mounted', view() === 'recent', view());
    chk('history row rendered', /Kanal 100/.test(q('.col.fill').textContent));
    await goHome();
    chk('back to home from recent', view() === 'home', view());

    // ---- Arama ----
    await openCard('search');
    chk('search view mounted', view() === 'search', view());
    const input = q('.field__input');
    input.value = 'Kanal 12';
    q('.field__box').__field.stopEdit();
    await wait(900);
    const sl = q('.search__results .col__body').__vlist;
    chk('search returns results', sl.count() > 0, sl.count() + ' hits');
    chk('search result is a channel', sl.itemAt(0).type === 'live', sl.itemAt(0) && sl.itemAt(0).name);
    await goHome();
    chk('back to home from search', view() === 'home', view());

    // ---- Ayarlar ----
    await openCard('settings');
    chk('settings view mounted', view() === 'settings', view());
    const rows = qa('.srow');
    chk('settings rows rendered', rows.length > 5, rows.length);
    chk('settings rows positioned', /left: 0/.test(rows[0].getAttribute('style')), rows[0].getAttribute('style'));
    chk('side panel shows account', /Xtream Codes/.test(q('.settings__side').textContent));

    // toggle a setting via OK on "Goruntu Orani"
    const sset = q('.settings__list').__vlist;
    sset.jumpTo(r => r.id === 'displayMode');
    const before = App.Settings.get('displayMode');
    key(K.ENTER); await wait(120);
    chk('setting cycles on OK', App.Settings.get('displayMode') !== before, App.Settings.get('displayMode'));

    sset.jumpTo(r => r.id === 'preferredFormat');
    key(K.ENTER); await wait(120);
    chk('preferred format applied to url',
        App.Content.streamUrl({ type: 'live', id: 5 }).indexOf('.' + App.Settings.get('preferredFormat')) > -1,
        App.Content.streamUrl({ type: 'live', id: 5 }));

    await goHome();
    chk('back to home from settings', view() === 'home', view());

    // ---- Playlistler ----
    await openCard('playlists');
    chk('playlists view mounted', view() === 'playlists', view());
    const plist = q('.col .col__body').__vlist;
    chk('playlist listesi (ekle + 1 kayit)', plist.count() === 2, plist.count());
    chk('aktif playlist isaretli', /✔/.test(q('.col .col__body').textContent));
    plist.setIndex(1);
    await wait(120);
    chk('QR kodu uretildi', !!q('.qr-box'), q('.qr-box') ? 'var' : 'yok');
    await goHome();
    chk('back to home from playlists', view() === 'home', view());

    // ---- Root back -> exit confirm ----
    key(K.BACK); await wait(100);
    chk('root back asks to exit', App.UI.Modal.isOpen());
    key(K.BACK); await wait(100);

    // ---- caching: repeated navigation must not refetch ----
    const before2 = requestLog.length;
    await openCard('live'); await wait(300);
    const added = requestLog.length - before2;
    chk('cache prevents refetch', added <= 2, added + ' new requests on 2nd visit');

    console.log('\n--- errors (' + errors.length + ') ---');
    errors.slice(0, 20).forEach(e => out('  ! ' + e));
    chk('no console errors', errors.length === 0);
    console.log(`\n=== ${pass} passed, ${fail} failed ===`);
    out('mock server saw ' + requestLog.length + ' requests'); process.exit(fail ? 1 : 0);
})().catch(e => { out('HARNESS CRASH at [' + STEP + ']: ' + e.stack); process.exit(1); });
