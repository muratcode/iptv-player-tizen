/* ============================================================
   js/core/storage.js
   Kalici veri katmani.

   TIZEN NOTU: Samsung TV web uygulamalarinda kalici depolama icin
   standart yontem HTML5 localStorage'dir (uygulama kaldirilana
   kadar korunur, ~5MB kota). tizen.filesystem yalnizca ek
   privilege ister ve wgt icin gereksizdir; bu yuzden localStorage
   kullaniyoruz. Kota dolarsa QuotaExceededError firlatilir ->
   yakalanip App.AppError(STORAGE) uretilir.

   GUVENLIK: localStorage sifreli degildir. Sifre alanini duz metin
   birakmamak icin cihaza ozel bir anahtarla XOR + Base64
   "obfuscation" uygulanir. Bu SIFRELEME DEGILDIR; amaci depolama
   dokumune bakan birinin sifreyi ciplak gozle okumasini onlemektir.
   (Tizen TV'de gercek bir keystore/secure storage web API'si yoktur.)
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('Storage');
    var PREFIX = 'iptv.';
    var memoryFallback = {};      /* localStorage tamamen calismazsa */
    var lsOk = true;

    /* localStorage gercekten yazilabiliyor mu? (gizli mod / bozuk profil) */
    try {
        window.localStorage.setItem(PREFIX + '__t', '1');
        window.localStorage.removeItem(PREFIX + '__t');
    } catch (e) {
        lsOk = false;
        log.warn('localStorage kullanilamiyor, bellek moduna gecildi:', e && e.message);
    }

    function rawGet(k) {
        if (!lsOk) { return Object.prototype.hasOwnProperty.call(memoryFallback, k) ? memoryFallback[k] : null; }
        try { return window.localStorage.getItem(k); } catch (e) { return null; }
    }
    function rawSet(k, v) {
        if (!lsOk) { memoryFallback[k] = v; return true; }
        try {
            window.localStorage.setItem(k, v);
            return true;
        } catch (e) {
            log.error('yazma hatasi', k, e && e.name);
            throw new App.AppError(App.ERR.STORAGE, (e && e.name) || 'setItem failed');
        }
    }
    function rawRemove(k) {
        if (!lsOk) { delete memoryFallback[k]; return; }
        try { window.localStorage.removeItem(k); } catch (e) { /* yoksay */ }
    }

    /* ---------- XOR obfuscation ---------- */
    /* Anahtar sabit degil; uygulama kimligi + basit bir tuz ile turetilir. */
    var OBF_KEY = (function () {
        var base = 'IptvPlyr01';
        try {
            if (window.tizen && tizen.application && tizen.application.getCurrentApplication) {
                base = tizen.application.getCurrentApplication().appInfo.id || base;
            }
        } catch (e) { /* PC tarayicisi */ }
        return base + '::s4lt::v1';
    })();

    function xor(str, key) {
        var out = '';
        for (var i = 0; i < str.length; i++) {
            out += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return out;
    }

    function obfuscate(plain) {
        if (plain === null || plain === undefined || plain === '') { return ''; }
        try {
            /* Once UTF-8 guvenli hale getir, sonra XOR, sonra base64 */
            var utf8 = unescape(encodeURIComponent(String(plain)));
            return 'x1:' + window.btoa(xor(utf8, OBF_KEY));
        } catch (e) {
            return String(plain);
        }
    }

    function deobfuscate(stored) {
        if (!stored) { return ''; }
        var s = String(stored);
        if (s.indexOf('x1:') !== 0) { return s; }  /* eski/duz kayit */
        try {
            var utf8 = xor(window.atob(s.substr(3)), OBF_KEY);
            return decodeURIComponent(escape(utf8));
        } catch (e) {
            return '';
        }
    }

    var S = {
        /** JSON degeri oku */
        get: function (key, def) {
            var raw = rawGet(PREFIX + key);
            if (raw === null || raw === undefined) { return def === undefined ? null : def; }
            try { return JSON.parse(raw); }
            catch (e) { return def === undefined ? null : def; }
        },

        /** JSON degeri yaz. Kota hatasinda AppError(STORAGE) firlatir. */
        set: function (key, value) {
            rawSet(PREFIX + key, JSON.stringify(value));
            return value;
        },

        /** Kota hatasini yutan guvenli yazma (onbellek gibi kritik olmayan veriler icin) */
        trySet: function (key, value) {
            try { S.set(key, value); return true; }
            catch (e) { log.warn('trySet basarisiz:', key); return false; }
        },

        remove: function (key) { rawRemove(PREFIX + key); },

        has: function (key) { return rawGet(PREFIX + key) !== null; },

        /** Hassas metin yaz/oku (sifre) */
        setSecret: function (key, plain) { return S.set(key, obfuscate(plain)); },
        getSecret: function (key) { return deobfuscate(S.get(key, '')); },

        /** Sadece bu uygulamaya ait anahtarlar */
        keys: function () {
            var out = [];
            if (!lsOk) {
                for (var mk in memoryFallback) {
                    if (mk.indexOf(PREFIX) === 0) { out.push(mk.substr(PREFIX.length)); }
                }
                return out;
            }
            try {
                for (var i = 0; i < window.localStorage.length; i++) {
                    var k = window.localStorage.key(i);
                    if (k && k.indexOf(PREFIX) === 0) { out.push(k.substr(PREFIX.length)); }
                }
            } catch (e) { /* yoksay */ }
            return out;
        },

        /** Belirli on eke sahip anahtarlari sil (ornek: 'cache.') */
        removeByPrefix: function (p) {
            var ks = S.keys(), n = 0;
            for (var i = 0; i < ks.length; i++) {
                if (ks[i].indexOf(p) === 0) { rawRemove(PREFIX + ks[i]); n++; }
            }
            return n;
        },

        /** Uygulamanin TUM verisini sil (fabrika ayarlari) */
        clearAll: function () {
            var ks = S.keys();
            for (var i = 0; i < ks.length; i++) { rawRemove(PREFIX + ks[i]); }
            memoryFallback = {};
            return ks.length;
        },

        /** Yaklasik kullanilan alan (KB) - Ayarlar ekraninda gosterilir */
        usageKB: function () {
            var total = 0, ks = S.keys();
            for (var i = 0; i < ks.length; i++) {
                var v = rawGet(PREFIX + ks[i]);
                total += (ks[i].length + (v ? v.length : 0)) * 2; /* UTF-16 */
            }
            return Math.round(total / 1024);
        },

        isPersistent: function () { return lsOk; }
    };

    App.Storage = S;
})(window.App = window.App || {});
