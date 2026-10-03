/* ============================================================
   js/core/utils.js - Genel yardimci fonksiyonlar
   ============================================================ */
(function (App) {
    'use strict';

    var U = {};

    /* ---------------- DOM ---------------- */
    U.qs = function (sel, root) { return (root || document).querySelector(sel); };
    U.qsa = function (sel, root) {
        var n = (root || document).querySelectorAll(sel), out = [];
        for (var i = 0; i < n.length; i++) { out.push(n[i]); }
        return out;
    };

    /**
     * Element olusturucu.
     * U.el('div', 'sinif adi', 'metin')  veya  U.el('div', {className:'x', html:'<b>a</b>'})
     */
    U.el = function (tag, clsOrOpts, text) {
        var e = document.createElement(tag);
        if (typeof clsOrOpts === 'string') {
            if (clsOrOpts) { e.className = clsOrOpts; }
            if (text !== undefined && text !== null) { e.textContent = String(text); }
        } else if (clsOrOpts) {
            var o = clsOrOpts;
            if (o.className) { e.className = o.className; }
            if (o.id) { e.id = o.id; }
            if (o.text !== undefined) { e.textContent = String(o.text); }
            if (o.html !== undefined) { e.innerHTML = o.html; }
            if (o.attrs) {
                for (var k in o.attrs) {
                    if (Object.prototype.hasOwnProperty.call(o.attrs, k)) {
                        e.setAttribute(k, o.attrs[k]);
                    }
                }
            }
            if (o.style) {
                for (var s in o.style) {
                    if (Object.prototype.hasOwnProperty.call(o.style, s)) { e.style[s] = o.style[s]; }
                }
            }
        }
        return e;
    };

    U.empty = function (node) {
        if (!node) { return; }
        while (node.firstChild) { node.removeChild(node.firstChild); }
    };

    U.addClass = function (el, c) { if (el) { el.classList.add(c); } };
    U.removeClass = function (el, c) { if (el) { el.classList.remove(c); } };
    U.toggleClass = function (el, c, on) {
        if (!el) { return; }
        if (on) { el.classList.add(c); } else { el.classList.remove(c); }
    };

    U.escapeHtml = function (s) {
        if (s === null || s === undefined) { return ''; }
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };

    /* ---------------- Metin ---------------- */

    /** Base64 -> UTF-8 metin. Xtream EPG basliklari base64 gelir. */
    U.b64decode = function (str) {
        if (!str) { return ''; }
        try {
            var bin = window.atob(String(str).replace(/\s/g, ''));
            /* UTF-8 cozumleme (Turkce karakterler icin sart) */
            try {
                return decodeURIComponent(bin.split('').map(function (c) {
                    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                }).join(''));
            } catch (e2) {
                return bin;
            }
        } catch (e) {
            return String(str);
        }
    };

    /** Arama/karsilastirma icin Turkce duyarli normalizasyon */
    U.normalize = function (s) {
        if (!s) { return ''; }
        return String(s)
            .replace(/[İIı]/g, 'i').replace(/[Şş]/g, 's').replace(/[Ğğ]/g, 'g')
            .replace(/[Üü]/g, 'u').replace(/[Öö]/g, 'o').replace(/[Çç]/g, 'c')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    };

    U.initials = function (name) {
        if (!name) { return '?'; }
        var parts = String(name).replace(/[^\wçğıöşüÇĞİÖŞÜ ]/g, ' ').trim().split(/\s+/);
        var s = (parts[0] || '').charAt(0);
        if (parts.length > 1) { s += (parts[1] || '').charAt(0); }
        return s.toUpperCase() || '?';
    };

    U.truncate = function (s, n) {
        s = String(s || '');
        return s.length > n ? s.substr(0, n - 1) + '…' : s;
    };

    /* ---------------- Sayi / zaman ---------------- */
    U.pad2 = function (n) { return (n < 10 ? '0' : '') + n; };

    U.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };

    U.toInt = function (v, def) {
        var n = parseInt(v, 10);
        return isNaN(n) ? (def === undefined ? 0 : def) : n;
    };

    /** 09:45 */
    U.hhmm = function (d) {
        if (!d) { return '--:--'; }
        if (!(d instanceof Date)) { d = new Date(d); }
        if (isNaN(d.getTime())) { return '--:--'; }
        return U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes());
    };

    /** 30.08.2026 */
    U.ddmmyyyy = function (d) {
        if (!d) { return '-'; }
        if (!(d instanceof Date)) { d = new Date(d); }
        if (isNaN(d.getTime())) { return '-'; }
        return U.pad2(d.getDate()) + '.' + U.pad2(d.getMonth() + 1) + '.' + d.getFullYear();
    };

    /** Saniye -> 1:23:45 / 4:05 */
    U.duration = function (sec) {
        sec = Math.max(0, Math.floor(sec || 0));
        var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        return h > 0 ? (h + ':' + U.pad2(m) + ':' + U.pad2(s)) : (m + ':' + U.pad2(s));
    };

    /**
     * Xtream API tarih alanlari cok farkli formatlarda gelebilir:
     *  - unix timestamp (saniye, string)
     *  - "2026-08-30 21:00:00"
     *  - ISO 8601
     * Hepsini Date'e cevirir, cozemezse null doner.
     */
    U.parseDate = function (v) {
        if (v === null || v === undefined || v === '') { return null; }
        if (v instanceof Date) { return isNaN(v.getTime()) ? null : v; }
        var s = String(v).trim();
        if (/^\d{9,13}$/.test(s)) {
            var num = parseInt(s, 10);
            if (s.length <= 10) { num *= 1000; }
            var d0 = new Date(num);
            return isNaN(d0.getTime()) ? null : d0;
        }
        /* "2026-08-30 21:00:00" -> Safari/eski webkit icin "T" ile duzelt */
        var d = new Date(s.replace(' ', 'T'));
        if (isNaN(d.getTime())) { d = new Date(s); }
        return isNaN(d.getTime()) ? null : d;
    };

    /**
     * XMLTV tarih formati: "20260830210000 +0300"
     * Zaman dilimi ofsetini dikkate alir.
     */
    U.parseXmltvDate = function (s) {
        if (!s) { return null; }
        var m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(String(s).trim());
        if (!m) { return null; }
        var ms = Date.UTC(
            parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10),
            parseInt(m[4], 10), parseInt(m[5], 10), parseInt(m[6] || '0', 10)
        );
        if (m[7]) {
            var sign = m[7].charAt(0) === '-' ? 1 : -1;
            var oh = parseInt(m[7].substr(1, 2), 10), om = parseInt(m[7].substr(3, 2), 10);
            ms += sign * (oh * 3600 + om * 60) * 1000;
        }
        var d = new Date(ms);
        return isNaN(d.getTime()) ? null : d;
    };

    /* ---------------- Fonksiyonel ---------------- */
    U.debounce = function (fn, wait) {
        var t = null;
        return function () {
            var ctx = this, args = arguments;
            if (t) { clearTimeout(t); }
            t = setTimeout(function () { t = null; fn.apply(ctx, args); }, wait);
        };
    };

    U.throttle = function (fn, wait) {
        var last = 0, timer = null;
        return function () {
            var ctx = this, args = arguments, now = Date.now();
            var remain = wait - (now - last);
            if (remain <= 0) {
                if (timer) { clearTimeout(timer); timer = null; }
                last = now; fn.apply(ctx, args);
            } else if (!timer) {
                timer = setTimeout(function () {
                    last = Date.now(); timer = null; fn.apply(ctx, args);
                }, remain);
            }
        };
    };

    /** Uzun donguleri parcalayarak TV arayuzunu kilitlememek icin */
    U.chunked = function (items, chunkSize, worker, onProgress) {
        return new Promise(function (resolve, reject) {
            var i = 0, total = items.length;
            function step() {
                var end = Math.min(i + chunkSize, total);
                try {
                    for (; i < end; i++) { worker(items[i], i); }
                } catch (e) { return reject(e); }
                if (onProgress) { onProgress(i, total); }
                if (i < total) { setTimeout(step, 0); } else { resolve(); }
            }
            step();
        });
    };

    /* ---------------- Olcu ----------------
       CSS'te her sey rem cinsindendir (html font-size = 100vw/120).
       Sanal liste satir yuksekligi gibi JS'te piksel gereken yerlerde
       U.rem(4.5) -> o anki ekranda kac piksel ettigini verir.
       Boylece 1080p ve 4K'da ayni kod calisir. */
    /* PERFORMANS: getComputedStyle() ZORUNLU SENKRON LAYOUT tetikler.
       Bu fonksiyon sanal listede her satir icin cagriliyor; onbelleklenmezse
       her kaydirma adiminda onlarca layout hesabi yapilir ve TV gozle gorulur
       sekilde kasar. Deger yalnizca ekran boyutu degisince gecersiz olur. */
    var _remBase = 0;
    U.rem = function (n) {
        if (!_remBase) {
            _remBase = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
        }
        return Math.round(n * _remBase);
    };
    U.invalidateRem = function () { _remBase = 0; };
    window.addEventListener('resize', function () { _remBase = 0; }, false);

    /* ---------------- URL ---------------- */

    /** "1.2.3.4:8080" -> "http://1.2.3.4:8080" ; sondaki / ve /player_api.php temizlenir */
    U.normalizeHost = function (host) {
        var h = String(host || '').trim();
        if (!h) { return ''; }
        h = h.replace(/\s+/g, '');
        if (!/^https?:\/\//i.test(h)) { h = 'http://' + h; }
        h = h.replace(/\/+$/, '');
        h = h.replace(/\/(player_api\.php|panel_api\.php|get\.php|xmltv\.php).*$/i, '');
        return h;
    };

    U.buildQuery = function (params) {
        var parts = [];
        for (var k in params) {
            if (Object.prototype.hasOwnProperty.call(params, k)) {
                var v = params[k];
                if (v === undefined || v === null || v === '') { continue; }
                parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
            }
        }
        return parts.join('&');
    };

    /** Basit deterministik hash - profil anahtari uretmek icin */
    U.hash = function (str) {
        var h = 5381, s = String(str || '');
        for (var i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; }
        return h.toString(36);
    };

    /** Dizi guvenli okuma: U.arr(x) daima dizi doner */
    U.arr = function (v) {
        if (Array.isArray(v)) { return v; }
        if (v === null || v === undefined || v === '') { return []; }
        if (typeof v === 'object') {
            /* Bazi Xtream panelleri diziyi {"0":{...},"1":{...}} olarak dondurur */
            var out = [];
            for (var k in v) {
                if (Object.prototype.hasOwnProperty.call(v, k)) { out.push(v[k]); }
            }
            return out;
        }
        return [];
    };

    App.Utils = U;
})(window.App = window.App || {});
