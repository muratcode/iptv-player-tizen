/* ============================================================
   player/seekcheck.js
   MKV dosyasinda TV'nin SARMA yapip yapamayacagini oynatmadan once
   anlar.

   NEDEN
   -----
   Matroska (MKV) dosyalarinda sarma icin "Cues" adli bir dizin vardir;
   yeri dosyanin basindaki SeekHead ("icindekiler") bolumunde yazar.
   Bazi dosyalarda (ornek: sonradan mkvpropedit ile duzenlenenler)
   bastaki SeekHead dizini DOGRUDAN gostermez, yalnizca dosyanin
   sonundaki ikinci bir SeekHead'i gosterir. Samsung AVPlay bu ikinci
   adimi takip etmez: dizini bulamaz, her seekTo'yu aninda reddeder
   (PLAYER_ERROR_SEEK_FAILED) ve ardindan goruntu takili kalir. HTML5
   <video> da ayni dosyada sarinca donar. Gercek TV'de (Tizen 9.0)
   olculdu: ayni sunucudaki diger dizilerde sorun yok.

   Bu yuzden dosyanin ILK 8 KB'i okunur (HTTP Range); bastaki SeekHead
   Cues'u gostermiyorsa bu icerikte sarma ve "kaldigi yerden devam"
   bastan kapatilir: goruntu hic donmaz, kullaniciya acikca soylenir.

   - Yalnizca MKV film/bolumlerde, oynatmadan ONCE calisir (hesap tek
     baglantiliysa bile AVPlay ile cakismaz; istek bitip kapanir).
   - Sonuc icerik basina cihazda saklanir; ayni bolum tekrar acilinca
     istek atilmaz.
   - Sunucu Range desteklemezse, yanit gecikirse veya bicim taninmazsa
     sonuc 'unknown'dur ve hicbir sey engellenmez.
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('SeekCheck');

    var K_CACHE = 'seekcheck.v1';     /* { icerikAnahtari: 'ok' | 'noindex' } */
    var CACHE_MAX = 600;
    var READ_BYTES = 8192;
    var TIMEOUT_MS = 2500;

    var ID_SEGMENT = 0x18538067;
    var ID_SEEKHEAD = 0x114D9B74;
    var ID_SEEK = 0x4DBB;
    var ID_SEEKID = 0x53AB;
    var ID_CUES = 0x1C53BB6B;
    var ID_CLUSTER = 0x1F43B675;

    var memo = null;

    function cache() {
        if (!memo) { memo = App.Storage.get(K_CACHE, null) || {}; }
        return memo;
    }

    function remember(key, verdict) {
        var c = cache();
        c[key] = verdict;
        var keys = Object.keys(c);
        if (keys.length > CACHE_MAX) {
            /* en eskileri at (ekleme sirasi korunur) */
            for (var i = 0; i < keys.length - CACHE_MAX; i++) { delete c[keys[i]]; }
        }
        App.Storage.set(K_CACHE, c);
    }

    /* EBML degisken uzunluklu tamsayi. keepMarker: eleman kimligi icin */
    function vint(b, p, keepMarker) {
        if (p >= b.length) { return null; }
        var first = b[p];
        var len = 1;
        var mask = 0x80;
        while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
        if (len > 8 || p + len > b.length) { return null; }
        var v = keepMarker ? first : (first & (mask - 1));
        for (var i = 1; i < len; i++) { v = v * 256 + b[p + i]; }
        return { v: v, len: len };
    }

    /** [start, end) araligindaki elemanlar: {id, data, size} */
    function children(b, start, end) {
        var out = [];
        var p = start;
        while (p < end && p < b.length) {
            var id = vint(b, p, true);
            if (!id) { break; }
            var sz = vint(b, p + id.len, false);
            if (!sz) { break; }
            var data = p + id.len + sz.len;
            out.push({ id: id.v, data: data, size: sz.v });
            if (sz.v > 1e12) { break; }            /* "bilinmeyen boyut" (Segment/Cluster) */
            p = data + sz.v;
        }
        return out;
    }

    /**
     * @param {Uint8Array} b dosyanin basi
     * @returns {string} 'ok' | 'noindex' | 'unknown'
     */
    function verdictOf(b) {
        var top = children(b, 0, b.length);
        var seg = null;
        for (var i = 0; i < top.length; i++) { if (top[i].id === ID_SEGMENT) { seg = top[i]; break; } }
        if (!seg) { return 'unknown'; }

        var kids = children(b, seg.data, b.length);
        for (var k = 0; k < kids.length; k++) {
            var el = kids[k];
            if (el.id === ID_CUES) { return 'ok'; }          /* dizin en basta */
            if (el.id === ID_CLUSTER) { break; }             /* goruntu verisi basladi */
            if (el.id !== ID_SEEKHEAD) { continue; }
            if (el.data + el.size > b.length) { return 'unknown'; }

            /* Ilk SeekHead: Cues'u dogrudan gosteriyor mu? */
            var seeks = children(b, el.data, el.data + el.size);
            for (var s = 0; s < seeks.length; s++) {
                if (seeks[s].id !== ID_SEEK) { continue; }
                var f = children(b, seeks[s].data, seeks[s].data + seeks[s].size);
                for (var j = 0; j < f.length; j++) {
                    if (f[j].id !== ID_SEEKID) { continue; }
                    var target = vint(b, f[j].data, true);
                    if (target && target.v === ID_CUES) { return 'ok'; }
                }
            }
            return 'noindex';
        }
        return 'unknown';
    }

    function fetchHead(url) {
        return new Promise(function (resolve) {
            var x = new XMLHttpRequest();
            var done = false;
            function fin(v) {
                if (done) { return; }
                done = true;
                clearTimeout(t);
                resolve(v);
            }
            var t = setTimeout(function () {
                try { x.abort(); } catch (e) { }
                fin(null);
            }, TIMEOUT_MS);
            try {
                x.open('GET', url, true);
                x.responseType = 'arraybuffer';
                x.setRequestHeader('Range', 'bytes=0-' + (READ_BYTES - 1));
                x.onreadystatechange = function () {
                    /* Range'i yok sayan sunucu dosyanin TAMAMINI gonderir: hemen kes */
                    if (x.readyState === 2 && x.status !== 206) {
                        try { x.abort(); } catch (e) { }
                        fin(null);
                    }
                };
                x.onload = function () {
                    fin(x.status === 206 && x.response ? new Uint8Array(x.response) : null);
                };
                x.onerror = function () { fin(null); };
                x.send();
            } catch (e) { fin(null); }
        });
    }

    function isMkv(item, url) {
        var ext = String((item && item.containerExtension) || '').toLowerCase();
        return ext === 'mkv' || /\.mkv(\?|$)/i.test(String(url || ''));
    }

    App.SeekCheck = {
        /**
         * @param {object} item normalize edilmis icerik
         * @param {string} url  oynatilacak adres
         * @returns {Promise<string>} 'ok' | 'noindex' | 'unknown'
         */
        check: function (item, url) {
            if (!item || item.type === 'live' || !isMkv(item, url)) { return Promise.resolve('unknown'); }
            var key = item.key || url;
            var known = cache()[key];
            if (known) { return Promise.resolve(known); }

            var t0 = Date.now();
            return fetchHead(url).then(function (b) {
                var v = b ? verdictOf(b) : 'unknown';
                log.info('MKV sarma dizini:', v, '(' + (Date.now() - t0) + ' ms)', item.name || '');
                if (v !== 'unknown') { remember(key, v); }
                return v;
            });
        },

        /** Film/bolum MKV mi (uzanti veya adres) */
        isMkv: isMkv,

        /* testler icin */
        _verdictOf: verdictOf
    };
})(window.App = window.App || {});
