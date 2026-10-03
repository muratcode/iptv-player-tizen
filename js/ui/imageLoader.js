/* ============================================================
   js/ui/imageLoader.js
   Kanal logolari / film afisleri icin kuyruklu, sinirli esz amanli
   goruntu yukleyici.

   NEDEN GEREKLI?
   Bir IPTV playlistinde 8.000 kanal olabilir. Hepsinin logosunu
   ayni anda istemek TV'nin ag yiginini ve belligini kilitler.
   Bu modul:
     - Ayni anda en fazla MAX_PARALLEL istek yapar,
     - Ekrandan cikan ogenin isteklerini iptal eder (kuyruktan atar),
     - Bozuk/erisilemeyen URL'leri hatirlar ve tekrar denemez,
     - Basarili URL'leri "yuklendi" olarak isaretler (aninda gosterim).
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('Img');
    App.UI = App.UI || {};

    var MAX_PARALLEL = 4;
    /* Hizli kaydirmada her satir icin aninda istek acmak yerine kisa bir
       gecikme koyariz; kullanici gecip gittiyse is kuyruktan zaten dusurulur.
       Bu, TV'nin ag yigininin kaydirma sirasinda tikanmasini onler. */
    var START_DELAY = 90;
    var queue = [];               /* {url, el, token} */
    var running = 0;
    var pumpTimer = null;
    var failedUrls = {};          /* url -> true (bir daha deneme) */
    var okUrls = {};              /* url -> true */
    var tokenSeq = 0;

    function pump() {
        while (running < MAX_PARALLEL && queue.length) {
            var job = queue.shift();
            /* Oge DOM'dan cikmis veya baska icerige gecmisse atla */
            if (!job.el || job.el.__imgToken !== job.token) { continue; }
            load(job);
        }
    }

    function schedulePump() {
        if (pumpTimer) { return; }
        pumpTimer = setTimeout(function () { pumpTimer = null; pump(); }, START_DELAY);
    }

    function load(job) {
        running++;
        var img = new Image();
        var settled = false;

        function finish(ok) {
            if (settled) { return; }
            settled = true;
            running--;
            if (ok) {
                okUrls[job.url] = true;
                if (job.el && job.el.__imgToken === job.token) {
                    job.el.__imgShown = job.url;     /* tekrar yuklemeyi onler */
                    job.onLoad(img);
                }
            } else {
                failedUrls[job.url] = true;
                if (job.el && job.el.__imgToken === job.token && job.onError) { job.onError(); }
            }
            pump();
        }

        img.onload = function () { finish(true); };
        img.onerror = function () { finish(false); };

        /* TV'de bazi CDN'ler cok yavas yanit verir -> 8 sn sonra vazgec */
        setTimeout(function () {
            if (!settled) { img.src = ''; finish(false); }
        }, 8000);

        img.src = job.url;
    }

    App.UI.ImageLoader = {
        /**
         * @param {HTMLElement} host  Goruntunun yerlestirilecegi kapsayici
         * @param {string} url
         * @param {function(HTMLImageElement)} onLoad
         * @param {function} [onError]
         */
        load: function (host, url, onLoad, onError) {
            if (!host) { return; }

            /* Her cagri yeni bir token uretir; sanal listede ayni DOM ogesi
               yeniden kullanildiginda eski istek gecersiz kalir. */
            var token = ++tokenSeq;
            host.__imgToken = token;

            if (!url) { if (onError) { onError(); } return; }
            if (failedUrls[url]) { if (onError) { onError(); } return; }

            queue.push({
                url: url, el: host, token: token,
                onLoad: onLoad || function () { },
                onError: onError
            });
            schedulePump();
        },

        /**
         * Kolaylik: kapsayiciya <img> koyar, hata olursa yerine
         * kanal adinin bas harflerini yazar.
         */
        into: function (host, url, fallbackText) {
            var U = App.Utils;

            /* Sanal listede ayni DOM ogesi tekrar tekrar kullanilir. Gosterilen
               gorsel zaten dogruysa hicbir sey yapma - bu, kaydirma sirasindaki
               en buyuk gereksiz is kaynagidir. */
            if (url && host.__imgShown === url) { return; }
            host.__imgShown = '';

            U.empty(host);
            host.appendChild(U.el('span', 'ch__fallback', fallbackText || ''));

            App.UI.ImageLoader.load(host, url, function (img) {
                U.empty(host);
                host.appendChild(img);
            });
        },

        /** Ekran degisiminde bekleyen isleri temizle */
        flush: function () {
            queue.length = 0;
            if (pumpTimer) { clearTimeout(pumpTimer); pumpTimer = null; }
        },

        stats: function () {
            var f = 0, o = 0, k;
            for (k in failedUrls) { if (Object.prototype.hasOwnProperty.call(failedUrls, k)) { f++; } }
            for (k in okUrls) { if (Object.prototype.hasOwnProperty.call(okUrls, k)) { o++; } }
            return { queued: queue.length, running: running, ok: o, failed: f };
        },

        resetFailures: function () { failedUrls = {}; }
    };
})(window.App = window.App || {});
