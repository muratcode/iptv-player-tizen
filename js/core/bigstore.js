/* ============================================================
   js/core/bigstore.js
   BUYUK VERI DEPOSU (IndexedDB)

   NEDEN GEREKLI?
   localStorage kotasi Samsung TV'de yaklasik 5 MB'tir ve TUM uygulama
   verisi (hesaplar, favoriler, gecmis, onbellek) bu alani paylasir.
   Buyuk bir M3U playlisti cozumlendikten sonra kompakt bicimde bile
   birkac MB tutabilir; kota dolunca yazma basarisiz olur ve playlist
   HER ACILISTA yeniden indirilip cozumlenir ("playlist cihaza
   kaydedilemedi" uyarisi).

   COZUM: Buyuk bloklar IndexedDB'ye yazilir. Tizen TV'de IndexedDB
   kotasi localStorage'dan cok daha genistir (onlarca MB) ve veri
   uygulama kaldirilana kadar korunur.

   TASARIM
     - Tamamen ES5 + callback tabanli IndexedDB API'si, Promise sarmali.
     - IndexedDB yoksa veya acilamazsa SESSIZCE localStorage'a duser;
       cagiran taraf farki bilmek zorunda degildir.
     - Her kayit {v: deger, e: sonKullanma} bicimindedir (TTL destegi).

   NOT: localStorage'dan farkli olarak IndexedDB ASENKRONDUR; bu yuzden
   tum metotlar Promise doner.
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('BigStore');

    var DB_NAME = 'iptvplayer';
    var STORE = 'kv';
    var VERSION = 1;

    var idb = window.indexedDB || window.webkitIndexedDB || window.mozIndexedDB;
    var dbPromise = null;
    var usingFallback = !idb;

    if (usingFallback) {
        log.warn('IndexedDB yok -> localStorage yedegi kullanilacak');
    }

    function fail(detail) {
        return new App.AppError(App.ERR.STORAGE, detail);
    }

    function openDb() {
        if (dbPromise) { return dbPromise; }

        dbPromise = new Promise(function (resolve, reject) {
            if (!idb) { return reject(fail('IndexedDB yok')); }

            var req;
            try { req = idb.open(DB_NAME, VERSION); }
            catch (e) { return reject(fail('open: ' + (e && e.message))); }

            req.onupgradeneeded = function () {
                var db = req.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE);
                }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(fail('open error')); };
            req.onblocked = function () { reject(fail('open blocked')); };

            /* Bazi TV firmware'lerinde hicbir olay tetiklenmeyebilir */
            setTimeout(function () { reject(fail('open timeout')); }, 6000);
        }).catch(function (e) {
            usingFallback = true;
            log.warn('IndexedDB acilamadi, localStorage yedegine gecildi:', e && e.detail);
            throw e;
        });

        return dbPromise;
    }

    /**
     * Tek islemlik transaction yardimcisi.
     * @param {string} mode 'readonly' | 'readwrite'
     * @param {function(IDBObjectStore): IDBRequest} fn
     */
    function run(mode, fn) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var t, store, req;
                try {
                    t = db.transaction(STORE, mode);
                    store = t.objectStore(STORE);
                    req = fn(store);
                } catch (e) {
                    return reject(fail('tx: ' + (e && e.message)));
                }

                var result;
                if (req) {
                    req.onsuccess = function () { result = req.result; };
                    req.onerror = function () { reject(fail('request error')); };
                }
                t.oncomplete = function () { resolve(result); };
                t.onerror = function () { reject(fail('tx error')); };
                t.onabort = function () {
                    /* Kota asimi burada gelir */
                    reject(fail('tx aborted (kota?)'));
                };
            });
        });
    }

    /* ---------------- localStorage yedegi ---------------- */
    var FB_PREFIX = 'big.';

    function fbSet(key, rec) {
        return new Promise(function (resolve, reject) {
            if (App.Storage.trySet(FB_PREFIX + key, rec)) { resolve(true); }
            else { reject(fail('localStorage kotasi doldu')); }
        });
    }
    function fbGet(key) {
        return Promise.resolve(App.Storage.get(FB_PREFIX + key, null));
    }
    function fbRemove(key) {
        App.Storage.remove(FB_PREFIX + key);
        return Promise.resolve();
    }

    var B = {
        /** IndexedDB gercekten kullaniliyor mu? (Ayarlar ekraninda gosterilir) */
        backend: function () { return usingFallback ? 'localStorage' : 'IndexedDB'; },

        /**
         * @param {string} key
         * @param {*} value
         * @param {number} [ttlMs]
         * @returns {Promise<boolean>}
         */
        set: function (key, value, ttlMs) {
            var rec = { v: value, e: ttlMs ? (Date.now() + ttlMs) : 0 };

            if (usingFallback) { return fbSet(key, rec); }

            return run('readwrite', function (store) {
                return store.put(rec, key);
            }).then(function () {
                return true;
            }, function (e) {
                /* IndexedDB yazamadi -> localStorage'i dene */
                log.warn('IndexedDB yazma basarisiz, yedege gecildi:', e && e.detail);
                usingFallback = true;
                return fbSet(key, rec);
            });
        },

        /**
         * @param {string} key
         * @returns {Promise<*|undefined>} suresi dolmussa undefined
         */
        get: function (key) {
            var handle = function (rec) {
                if (!rec) { return undefined; }
                if (rec.e && rec.e < Date.now()) {
                    B.remove(key);
                    return undefined;
                }
                return rec.v;
            };

            if (usingFallback) { return fbGet(key).then(handle); }

            return run('readonly', function (store) {
                return store.get(key);
            }).then(handle, function (e) {
                log.warn('IndexedDB okuma basarisiz, yedege bakiliyor:', e && e.detail);
                usingFallback = true;
                return fbGet(key).then(handle);
            });
        },

        remove: function (key) {
            if (usingFallback) { return fbRemove(key); }
            return run('readwrite', function (store) {
                return store['delete'](key);
            }).then(function () { return true; }, function () {
                return fbRemove(key);
            });
        },

        clear: function () {
            App.Storage.removeByPrefix(FB_PREFIX);
            if (usingFallback) { return Promise.resolve(true); }
            return run('readwrite', function (store) {
                return store.clear();
            }).then(function () { return true; }, function () { return false; });
        },

        /** Kaydin yaklasik boyutu (KB) - tani icin */
        sizeKB: function (key) {
            return B.get(key).then(function (v) {
                if (v === undefined) { return 0; }
                try { return Math.round(JSON.stringify(v).length / 1024); }
                catch (e) { return -1; }
            }, function () { return -1; });
        }
    };

    App.BigStore = B;
})(window.App = window.App || {});
