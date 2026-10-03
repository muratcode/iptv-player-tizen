/* Verify our pure-ES5 QR encoder against the reference npm `qrcode` package,
   module-by-module, across versions and ECC levels. */
const { JSDOM } = require('jsdom');
/* Referans kutuphane yalnizca DOGRULAMA icindir; uygulamaya DAHIL DEGILDIR.
   Kurulu degilse test kendi kodlayicisinin ic tutarliligini dogrular. */
let REF = null;
try { REF = require('qrcode'); } catch (e) { REF = null; }
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..');
const out = s => fs.writeSync(1, s + String.fromCharCode(10));
let pass = 0, fail = 0;
const chk = (t, ok, extra) => {
    if (ok) { pass++; out('PASS  ' + t + (extra ? ' :: ' + extra : '')); }
    else { fail++; out('FAIL  ' + t + (extra ? ' :: ' + extra : '')); process.exitCode = 1; }
};

const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously' });
const { window } = dom;
window.eval(fs.readFileSync(path.join(APP, 'js/ui/qrcode.js'), 'utf8'));
const QR = window.App.UI.QRCode;

const SAMPLES = [
    ['kisa', 'IPTV'],
    ['xtream get.php', 'http://SERVER:PORT/get.php?username=USERNAME&password=PASSWORD&type=m3u_plus&output=ts'],
    ['uzun m3u url', 'http://my-provider-hostname.example:8080/get.php?username=abcdefgh12345&password=zyxwvu987654&type=m3u_plus&output=mpegts'],
    ['turkce', 'Kuruluş Osman — Sezon 2 Bölüm 14 (ç, ğ, ı, ö, ş, ü)'],
    ['160 karakter', 'x'.repeat(160)],
    ['300 karakter', 'A'.repeat(300)],
    ['json', JSON.stringify({ t: 'xtream', h: 'http://SERVER:PORT', u: 'USERNAME', p: 'PASSWORD' })]
];

if (!REF) {
    out('NOT  referans `qrcode` paketi kurulu degil -> yalnizca temel kontroller');
    for (const [label, text] of SAMPLES) {
        try {
            const m = QR.make(text, 'M');
            chk('uretildi: ' + label, m.size >= 21 && m.modules.length === m.size, `v${m.version}`);
        } catch (e) { chk('uretildi: ' + label, false, e.message); }
    }
    out(`
=== ${pass} passed, ${fail} failed ===`);
    process.exit(fail ? 1 : 0);
}

for (const level of ['L', 'M']) {
    for (const [label, text] of SAMPLES) {
        let ours, ref;
        try { ours = QR.make(text, level); }
        catch (e) { chk(`${level} ${label}`, false, 'bizimki hata: ' + e.message); continue; }
        try { ref = REF.create([{ data: text, mode: 'byte' }], { errorCorrectionLevel: level }); }
        catch (e) { chk(`${level} ${label}`, false, 'referans hata: ' + e.message); continue; }

        if (ours.size !== ref.modules.size) {
            chk(`${level} ${label}`, false, `boyut ${ours.size} vs referans ${ref.modules.size}`);
            continue;
        }

        let diff = 0, firstDiff = null;
        for (let r = 0; r < ours.size; r++) {
            for (let c = 0; c < ours.size; c++) {
                const a = ours.modules[r][c] ? 1 : 0;
                const b = ref.modules.data[r * ours.size + c] ? 1 : 0;
                if (a !== b) { diff++; if (!firstDiff) firstDiff = `${r},${c}`; }
            }
        }
        chk(`${level} ${label}`, diff === 0,
            diff === 0 ? `v${ours.version} ${ours.size}x${ours.size}`
                       : `${diff} modul farkli (ilk: ${firstDiff}) v${ours.version}`);
    }
}

/* capacity guard */
try {
    QR.make('z'.repeat(600), 'M');
    chk('kapasite asiminda hata verir', false, 'hata vermedi');
} catch (e) {
    chk('kapasite asiminda hata verir', /cok uzun/.test(e.message), e.message);
}

out(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
