/* ============================================================
   services/favorites.js
   Favori kanallar / filmler / diziler.

   Favoriler PROFILE BAGLI DEGILDIR: kullanici hesap degistirse
   bile favori listesi korunur (ayni saglayicinin yeni hesabi
   olabilir). Ancak eslestirme 'key' alanina gore yapilir
   (ornek: 'live:1234'), bu yuzden farkli bir panelde ayni id
   farkli kanal olabilir -> ad da saklanir ve gosterimde kullanilir.
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('Fav');
    var U = App.Utils;

    var K = 'favorites';
    var MAX = 500;

    var list = null;              /* [{key, type, id, name, logo, num, categoryId, addedAt}] */
    var lookup = null;            /* key -> true */

    function load() {
        if (list) { return; }
        list = App.Storage.get(K, []) || [];
        lookup = {};
        for (var i = 0; i < list.length; i++) { lookup[list[i].key] = true; }
    }

    function persist() {
        try {
            App.Storage.set(K, list);
        } catch (e) {
            App.UI.Toast.error('Favori kaydedilemedi: depolama dolu');
            log.error('kaydedilemedi', e && e.code);
        }
    }

    function slim(item) {
        return {
            key: item.key,
            type: item.type,
            id: item.id,
            name: item.name,
            logo: item.logo || '',
            num: item.num || 0,
            categoryId: item.categoryId || '',
            categoryName: item.categoryName || '',
            url: item.url || '',                     /* M3U ogeleri icin sart */
            containerExtension: item.containerExtension || '',
            epgChannelId: item.epgChannelId || '',
            seriesId: item.seriesId || '',
            /* Bolumlerde DIZI ADI ve sezon/bolum numarasi da saklanmali:
               oynaticida baslik olarak gosterilir ve internetten altyazi
               ararken sorgunun kendisidir. Onceden dusuruluyordu ve
               favoriden acilan bolumde yalnizca "Bolum 1" kaliyordu. */
            seriesName: item.seriesName || '',
            season: item.season || 0,
            episodeNum: item.episodeNum || 0,
            addedAt: Date.now()
        };
    }

    var F = {
        /** @param {string} [type] 'live'|'movie'|'series'|'episode' */
        list: function (type) {
            load();
            if (!type) { return list.slice(); }
            return list.filter(function (x) { return x.type === type; });
        },

        count: function (type) { return F.list(type).length; },

        has: function (keyOrItem) {
            load();
            var key = typeof keyOrItem === 'string' ? keyOrItem : (keyOrItem && keyOrItem.key);
            return !!(key && lookup[key]);
        },

        add: function (item) {
            load();
            if (!item || !item.key) { return false; }
            if (lookup[item.key]) { return false; }
            list.unshift(slim(item));
            lookup[item.key] = true;
            while (list.length > MAX) {
                var removed = list.pop();
                delete lookup[removed.key];
            }
            persist();
            App.Bus.emit('favorites:change', { action: 'add', item: item });
            return true;
        },

        remove: function (keyOrItem) {
            load();
            var key = typeof keyOrItem === 'string' ? keyOrItem : (keyOrItem && keyOrItem.key);
            if (!key || !lookup[key]) { return false; }
            for (var i = 0; i < list.length; i++) {
                if (list[i].key === key) { list.splice(i, 1); break; }
            }
            delete lookup[key];
            persist();
            App.Bus.emit('favorites:change', { action: 'remove', key: key });
            return true;
        },

        /** @returns {boolean} yeni durum (true = favoride) */
        toggle: function (item) {
            if (F.has(item)) { F.remove(item); return false; }
            F.add(item);
            return true;
        },

        clear: function () {
            list = [];
            lookup = {};
            App.Storage.remove(K);
            App.Bus.emit('favorites:change', { action: 'clear' });
        },

        /** Bellekteki kopyayi tazele */
        invalidate: function () { list = null; lookup = null; }
    };

    App.Favorites = F;
})(window.App = window.App || {});
