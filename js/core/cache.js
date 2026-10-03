/* ============================================================
   js/core/cache.js
   Iki katmanli onbellek: bellek (hizli) + localStorage (kalici).

   AMAC: Ayni Xtream API cagrisinin (kategoriler, kanal listesi,
   EPG) TV her acildiginda tekrar tekrar yapilmasini onlemek.
   Binlerce kanalli listelerde bu, acilis suresini 8-10 sn'den
   200 ms'ye dusurur.

   Buyuk yukler (10.000 kanal ~ 3 MB) localStorage kotasini
   asabilir; bu durumda sessizce yalnizca bellek katmaninda
   tutulur ve uygulama calismaya devam eder.
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('Cache');
    var mem = {};                 /* { key: {v: value, e: expiresAt} } */
    var KEY_PREFIX = 'cache.';

    /* Varsayilan yasam sureleri (ms) */
    var TTL = {
        SHORT:  2 * 60 * 1000,        /* 2 dk  - EPG short */
        MEDIUM: 30 * 60 * 1000,       /* 30 dk - kanal listeleri */
        LONG:   6 * 60 * 60 * 1000,   /* 6 sa  - kategoriler */
        DAY:    24 * 60 * 60 * 1000,  /* 1 gun - VOD detaylari */
        WEEK:   7 * 24 * 60 * 60 * 1000 /* 1 hafta - cozumlenmis M3U playlisti */
    };

    function now() { return Date.now(); }

    function memGet(key) {
        var rec = mem[key];
        if (!rec) { return undefined; }
        if (rec.e && rec.e < now()) { delete mem[key]; return undefined; }
        return rec.v;
    }

    function diskGet(key) {
        var rec = App.Storage.get(KEY_PREFIX + key, null);
        if (!rec) { return undefined; }
        if (rec.e && rec.e < now()) {
            App.Storage.remove(KEY_PREFIX + key);
            return undefined;
        }
        return rec.v;
    }

    var C = {
        TTL: TTL,

        /**
         * @param {string} key
         * @returns {*} deger veya undefined
         */
        get: function (key) {
            var v = memGet(key);
            if (v !== undefined) { return v; }
            v = diskGet(key);
            if (v !== undefined) {
                /* Diskten geleni bellege de al */
                mem[key] = { v: v, e: now() + TTL.SHORT };
            }
            return v;
        },

        /**
         * @param {string} key
         * @param {*} value
         * @param {number} [ttl] ms
         * @param {boolean} [persist=true] localStorage'a da yazilsin mi
         */
        set: function (key, value, ttl, persist) {
            ttl = ttl || TTL.MEDIUM;
            var exp = now() + ttl;
            mem[key] = { v: value, e: exp };
            if (persist !== false) {
                var ok = App.Storage.trySet(KEY_PREFIX + key, { v: value, e: exp });
                if (!ok) { log.warn('disk onbellegine sigmadi, sadece bellekte:', key); }
            }
            return value;
        },

        remove: function (key) {
            delete mem[key];
            App.Storage.remove(KEY_PREFIX + key);
        },

        /** On eke uyan tum onbellek kayitlarini sil */
        invalidate: function (prefix) {
            var n = 0;
            for (var k in mem) {
                if (Object.prototype.hasOwnProperty.call(mem, k) && k.indexOf(prefix) === 0) {
                    delete mem[k]; n++;
                }
            }
            n += App.Storage.removeByPrefix(KEY_PREFIX + prefix);
            log.info('invalidate', prefix, n);
            return n;
        },

        clear: function () {
            mem = {};
            return App.Storage.removeByPrefix(KEY_PREFIX);
        },

        /** Sadece bellegi temizle (dusuk RAM uyarisinda) */
        clearMemory: function () { mem = {}; },

        /**
         * Onbellekli calistirici.
         *   Cache.wrap('live.cats', TTL.LONG, function(){ return api(...); })
         * Deger onbellekte varsa uretici CAGRILMAZ.
         * @param {string} key
         * @param {number} ttl
         * @param {function(): Promise} producer
         * @param {object} [opts] {persist:boolean, force:boolean}
         * @returns {Promise}
         */
        wrap: function (key, ttl, producer, opts) {
            opts = opts || {};
            if (!opts.force) {
                var hit = C.get(key);
                if (hit !== undefined) {
                    log.debug('HIT', key);
                    return Promise.resolve(hit);
                }
            }
            log.debug('MISS', key);
            return Promise.resolve()
                .then(producer)
                .then(function (val) {
                    C.set(key, val, ttl, opts.persist);
                    return val;
                });
        },

        /** Kayit gercekten DISKE yazilabildi mi? (kota kontrolu icin) */
        isPersisted: function (key) { return App.Storage.has(KEY_PREFIX + key); },

        /** Anahtarin ne zaman uretildigini gostermek icin (Ayarlar ekrani) */
        expiresAt: function (key) {
            var rec = mem[key] || App.Storage.get(KEY_PREFIX + key, null);
            return rec ? rec.e : 0;
        },

        stats: function () {
            var memCount = 0;
            for (var k in mem) { if (Object.prototype.hasOwnProperty.call(mem, k)) { memCount++; } }
            var diskKeys = App.Storage.keys().filter(function (x) { return x.indexOf(KEY_PREFIX) === 0; });
            return { memory: memCount, disk: diskKeys.length, kb: App.Storage.usageKB() };
        }
    };

    App.Cache = C;
})(window.App = window.App || {});
