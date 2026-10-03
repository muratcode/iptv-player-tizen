/* ============================================================
   js/core/http.js
   XMLHttpRequest tabanli HTTP istemcisi.

   NEDEN fetch() DEGIL?
   - XHR'da gercek bir 'timeout' ozelligi vardir; fetch'te AbortController
     gerekir ve bazi Tizen surumlerinde AbortController davranisi tutarsizdir.
   - XHR ilerleme (progress) olayi verir -> 50 MB'lik M3U indirilirken
     kullaniciya yuzde gosterebiliyoruz.
   - Tum Tizen surumlerinde ayni sekilde calisir.

   Tum hatalar App.AppError'a cevrilir; ham hata asla yukari sizmaz.
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('Http');
    var U = App.Utils;

    var DEFAULTS = {
        timeout: 20000,      /* ms */
        retries: 1,          /* basarisizlikta kac kez daha denensin */
        retryDelay: 1200,    /* ms */
        method: 'GET'
    };

    var activeRequests = [];   /* view degisiminde toplu iptal icin */

    function isOnline() {
        /* Tizen'de navigator.onLine guvenilirdir; ayrica systeminfo ile de bakilabilir */
        if (typeof navigator !== 'undefined' && navigator.onLine === false) { return false; }
        return true;
    }

    /**
     * Tek deneme.
     * @returns {Promise<{text:string, status:number, url:string}>}
     */
    function once(url, opts) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            var settled = false;

            function done(fn, arg) {
                if (settled) { return; }
                settled = true;
                var i = activeRequests.indexOf(xhr);
                if (i !== -1) { activeRequests.splice(i, 1); }
                fn(arg);
            }

            try {
                xhr.open(opts.method, url, true);
            } catch (e) {
                return done(reject, new App.AppError(App.ERR.NETWORK, 'open failed: ' + (e && e.message)));
            }

            xhr.timeout = opts.timeout;

            /* Bazi Xtream panelleri User-Agent/Referer olmadan 403 doner.
               TV tarayicisi bu basliklarin cogunu degistirmeye izin vermez;
               izin verilen ozel basliklari yine de gonderiyoruz. */
            try {
                if (opts.headers) {
                    for (var h in opts.headers) {
                        if (Object.prototype.hasOwnProperty.call(opts.headers, h)) {
                            xhr.setRequestHeader(h, opts.headers[h]);
                        }
                    }
                }
            } catch (e) { /* yoksay */ }

            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    done(resolve, { text: xhr.responseText, status: xhr.status, url: url });
                } else if (xhr.status === 401 || xhr.status === 403) {
                    done(reject, new App.AppError(App.ERR.AUTH, 'HTTP ' + xhr.status, { status: xhr.status }));
                } else if (xhr.status === 404) {
                    done(reject, new App.AppError(App.ERR.NOT_FOUND, 'HTTP 404', { status: 404 }));
                } else {
                    done(reject, new App.AppError(App.ERR.HTTP, 'HTTP ' + xhr.status, { status: xhr.status }));
                }
            };

            xhr.onerror = function () {
                /* status 0 => ag hatasi, DNS, CORS veya sunucu kapali */
                done(reject, new App.AppError(
                    isOnline() ? App.ERR.NETWORK : App.ERR.OFFLINE,
                    'network error (status 0)'
                ));
            };

            xhr.ontimeout = function () {
                done(reject, new App.AppError(App.ERR.TIMEOUT, opts.timeout + 'ms asildi'));
            };

            xhr.onabort = function () {
                done(reject, new App.AppError(App.ERR.ABORTED, 'aborted'));
            };

            if (opts.onProgress) {
                xhr.onprogress = function (ev) {
                    opts.onProgress(ev.loaded, ev.lengthComputable ? ev.total : 0);
                };
            }

            activeRequests.push(xhr);
            try {
                xhr.send(opts.body || null);
            } catch (e) {
                done(reject, new App.AppError(App.ERR.NETWORK, 'send failed: ' + (e && e.message)));
            }
        });
    }

    /**
     * Yeniden denemeli istek.
     * TIMEOUT ve NETWORK hatalarinda tekrar dener; AUTH/NOT_FOUND'da denemez.
     */
    function request(url, options) {
        var opts = Object.assign({}, DEFAULTS, options || {});

        if (!isOnline()) {
            return Promise.reject(new App.AppError(App.ERR.OFFLINE, 'navigator.onLine=false'));
        }

        var attempt = 0;
        function run() {
            attempt++;
            var t0 = Date.now();
            return once(url, opts).then(function (res) {
                log.debug(opts.method, (Date.now() - t0) + 'ms', res.status, U.truncate(url, 110));
                return res;
            }, function (err) {
                var retryable = (err.code === App.ERR.TIMEOUT || err.code === App.ERR.NETWORK ||
                                 (err.code === App.ERR.HTTP && err.status >= 500));
                if (retryable && attempt <= opts.retries) {
                    log.warn('yeniden deneniyor (' + attempt + '/' + opts.retries + ')', err.code, U.truncate(url, 90));
                    return new Promise(function (r) { setTimeout(r, opts.retryDelay); }).then(run);
                }
                log.error(err.code, err.detail, U.truncate(url, 110));
                throw err;
            });
        }
        return run();
    }

    var H = {
        request: request,

        /** Duz metin doner */
        getText: function (url, opts) {
            return request(url, opts).then(function (r) { return r.text; });
        },

        /**
         * JSON doner. Xtream panelleri hatali durumlarda JSON yerine
         * HTML hata sayfasi dondurebilir -> PARSE hatasina cevrilir.
         */
        getJson: function (url, opts) {
            return request(url, opts).then(function (r) {
                var t = (r.text || '').trim();
                if (!t) {
                    throw new App.AppError(App.ERR.EMPTY, 'bos yanit');
                }
                /* Bazi paneller basina BOM veya bosluk ekler */
                if (t.charCodeAt(0) === 0xFEFF) { t = t.substr(1); }
                try {
                    return JSON.parse(t);
                } catch (e) {
                    /* HTML dondu mu? */
                    if (t.charAt(0) === '<') {
                        throw new App.AppError(App.ERR.PARSE, 'JSON yerine HTML dondu');
                    }
                    throw new App.AppError(App.ERR.PARSE, 'JSON.parse: ' + (e && e.message));
                }
            });
        },

        /** Bir URL'e sadece erisilebiliyor mu diye bakar (HEAD desteklemeyen paneller icin GET) */
        ping: function (url, timeout) {
            return request(url, { timeout: timeout || 8000, retries: 0 })
                .then(function () { return true; }, function () { return false; });
        },

        /** Ekran degisiminde bekleyen tum istekleri iptal et */
        abortAll: function () {
            var n = activeRequests.length;
            while (activeRequests.length) {
                var x = activeRequests.pop();
                try { x.abort(); } catch (e) { /* yoksay */ }
            }
            if (n) { log.info(n + ' istek iptal edildi'); }
        },

        isOnline: isOnline,
        pending: function () { return activeRequests.length; }
    };

    App.Http = H;
})(window.App = window.App || {});
