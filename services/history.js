/* ============================================================
   services/history.js
   Son izlenenler + film/bolum kaldigi yerden devam bilgisi.

   - Ayni icerik tekrar izlenirse listede yukari tasinir (kopya olmaz).
   - Filmlerde/bolumlerde 'position' (saniye) saklanir; %95'ten
     fazlasi izlendiyse "izlendi" sayilir ve pozisyon sifirlanir.
   - Son izlenen CANLI kanal ayrica saklanir (uygulama acilisinda
     "kaldigin yerden devam et" onerisi icin).
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('History');

    var K = 'history';
    var K_LAST_LIVE = 'history.lastLive';
    var MAX = 60;

    var list = null;

    function load() {
        if (list) { return; }
        list = App.Storage.get(K, []) || [];
    }

    function persist() {
        App.Storage.trySet(K, list);
    }

    function slim(item, extra) {
        return {
            key: item.key,
            type: item.type,
            id: item.id,
            name: item.name,
            logo: item.logo || '',
            num: item.num || 0,
            url: item.url || '',
            categoryId: item.categoryId || '',
            categoryName: item.categoryName || '',
            containerExtension: item.containerExtension || '',
            epgChannelId: item.epgChannelId || '',
            seriesId: item.seriesId || '',
            /* Dizi adi olmadan "Son Izlenenler"den acilan bolumde ne baslik
               dogru gorunur ne de altyazi aramasi calisir. */
            seriesName: item.seriesName || '',
            season: item.season || 0,
            episodeNum: item.episodeNum || 0,
            watchedAt: Date.now(),
            position: (extra && extra.position) || 0,
            duration: (extra && extra.duration) || item.durationSecs || 0
        };
    }

    var H = {
        list: function (type) {
            load();
            var out = type ? list.filter(function (x) { return x.type === type; }) : list.slice();
            return out;
        },

        count: function () { load(); return list.length; },

        /** Izlemeye baslandiginda cagrilir */
        push: function (item) {
            if (!item || !item.key) { return; }
            load();
            for (var i = 0; i < list.length; i++) {
                if (list[i].key === item.key) {
                    var old = list.splice(i, 1)[0];
                    var rec0 = slim(item, { position: old.position, duration: old.duration });
                    list.unshift(rec0);
                    trim(); persist();
                    if (item.type === 'live') { App.Storage.trySet(K_LAST_LIVE, rec0); }
                    App.Bus.emit('history:change');
                    return;
                }
            }
            list.unshift(slim(item));
            trim(); persist();
            if (item.type === 'live') { App.Storage.trySet(K_LAST_LIVE, list[0]); }
            App.Bus.emit('history:change');
        },

        /**
         * Oynatma pozisyonunu guncelle (film/bolum).
         * Oynatici bunu ~15 saniyede bir cagirir.
         */
        updatePosition: function (key, positionSec, durationSec) {
            load();
            for (var i = 0; i < list.length; i++) {
                if (list[i].key !== key) { continue; }
                var finished = durationSec > 0 && (positionSec / durationSec) > 0.95;
                list[i].position = finished ? 0 : Math.floor(positionSec || 0);
                list[i].duration = Math.floor(durationSec || list[i].duration || 0);
                list[i].finished = finished;
                list[i].watchedAt = Date.now();
                persist();
                return;
            }
        },

        /** Kaldigi yer (saniye) - 30 sn'den kisaysa bastan basla */
        resumeOf: function (key) {
            load();
            for (var i = 0; i < list.length; i++) {
                if (list[i].key === key) {
                    var p = list[i].position || 0;
                    return p > 30 ? p : 0;
                }
            }
            return 0;
        },

        /** Izlenme yuzdesi 0..1 (poster uzerindeki cizgi icin) */
        progressOf: function (key) {
            load();
            for (var i = 0; i < list.length; i++) {
                if (list[i].key === key && list[i].duration > 0) {
                    return Math.min(1, (list[i].position || 0) / list[i].duration);
                }
            }
            return 0;
        },

        lastLive: function () { return App.Storage.get(K_LAST_LIVE, null); },

        remove: function (key) {
            load();
            for (var i = 0; i < list.length; i++) {
                if (list[i].key === key) { list.splice(i, 1); persist(); break; }
            }
            App.Bus.emit('history:change');
        },

        clear: function () {
            list = [];
            App.Storage.remove(K);
            App.Storage.remove(K_LAST_LIVE);
            App.Bus.emit('history:change');
        },

        invalidate: function () { list = null; }
    };

    function trim() {
        while (list.length > MAX) { list.pop(); }
    }

    App.History = H;
})(window.App = window.App || {});
