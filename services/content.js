/* ============================================================
   services/content.js
   ICERIK CEPHESI (facade).

   Ekranlar (views/*) Xtream mi M3U mu kullanildigini BILMEZ.
   Hepsi App.Content uzerinden ayni sekilde veri ister:

       App.Content.getLiveCategories()
       App.Content.getLiveChannels(categoryId)
       App.Content.streamUrl(item)

   Boylece ileride yeni bir kaynak turu (ornek: Stalker portal)
   eklenmek istenirse yalnizca bu dosya genisletilir.
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('Content');
    var U = App.Utils;

    var type = null;              /* 'xtream' | 'm3u' */
    var m3uData = null;           /* {items, groups, epgUrl, stats} */

    var ALL_ID = '__all__';
    var FAV_ID = '__fav__';

    function requireM3U() {
        if (!m3uData) {
            throw new App.AppError(App.ERR.EMPTY, 'M3U listesi yuklenmemis');
        }
        return m3uData;
    }

    /** M3U ogelerini turune gore suz */
    function m3uFilter(kind, categoryId) {
        var d = requireM3U();
        var out = [];
        for (var i = 0; i < d.items.length; i++) {
            var it = d.items[i];
            if (it.type !== kind) { continue; }
            if (categoryId && categoryId !== ALL_ID && it.categoryId !== categoryId) { continue; }
            out.push(it);
        }
        return out;
    }

    /**
     * Belirli bir turdeki (live/movie/series) ogelerin gruplarini dondurur.
     *
     * SIRALAMA: Gruplar ALFABETIK SIRALANMAZ. Saglayici playlisti bilerek
     * siralar (Turkce kanallar genelde en ustte olur) ve alfabetik siralama
     * bu duzeni bozar. Bu yuzden playlistteki ilk gorulme sirasi korunur.
     */
    function m3uGroupsFor(kind) {
        var d = requireM3U();
        var counts = {};
        var list = (kind === 'series') ? d.series : d.items;

        for (var i = 0; i < list.length; i++) {
            var it = list[i];
            if (kind !== 'series' && it.type !== kind) { continue; }
            counts[it.categoryId] = (counts[it.categoryId] || 0) + 1;
        }

        var out = [];
        for (var g = 0; g < d.groups.length; g++) {
            var grp = d.groups[g];
            if (!counts[grp.id]) { continue; }
            out.push({ id: grp.id, name: grp.name, count: counts[grp.id] });
        }
        return out;
    }

    /** M3U dizilerini kategoriye gore suz */
    function m3uSeries(categoryId) {
        var d = requireM3U();
        if (!categoryId || categoryId === ALL_ID) { return d.series.slice(); }
        var out = [];
        for (var i = 0; i < d.series.length; i++) {
            if (d.series[i].categoryId === categoryId) { out.push(d.series[i]); }
        }
        return out;
    }

    var C = {
        ALL_ID: ALL_ID,
        FAV_ID: FAV_ID,

        sourceType: function () { return type; },

        /**
         * Kaydedilmis profile gore servisleri hazirlar.
         * Uygulama acilisinda ve giris sonrasinda cagrilir.
         * M3U modunda playlist onbellekten gelir veya indirilir.
         */
        init: function (opts) {
            opts = opts || {};
            var p = App.Profile.get();
            if (!p) {
                type = null;
                return Promise.resolve(false);
            }
            type = p.type;

            if (type === 'xtream') {
                App.Xtream.configure(p);
                return Promise.resolve(true);
            }

            if (type === 'm3u') {
                var key = App.Profile.key('m3u.packed');

                /* Indir + cozumle + KALICI depoya yaz.
                   Depo olarak IndexedDB kullanilir (localStorage'in ~5 MB
                   kotasi buyuk playlistlere yetmiyordu); IndexedDB yoksa
                   BigStore sessizce localStorage'a duser. */
                function downloadAndStore() {
                    return App.M3U.load(p.m3uUrl, opts.onStatus).then(function (data) {
                        m3uData = data;
                        var small = App.M3U.pack(data);

                        return App.BigStore.set(key, small, App.Cache.TTL.WEEK).then(function () {
                            log.info('M3U kalici depoya yazildi (' + App.BigStore.backend() +
                                     '); sonraki acilislarda indirilmeyecek');
                        }, function (err) {
                            var e = App.AppError.wrap(err);
                            log.warn('M3U kalici depoya yazilamadi:', e.detail);
                            App.UI.Toast.warn(
                                'Playlist cihaza kaydedilemedi; her acilista yeniden indirilecek. ' +
                                'Ayarlar > Onbellegi Temizle deneyebilirsiniz.', 7000);
                        }).then(function () {
                            /* Playlist kendi EPG adresini bildirmisse profile yaz */
                            if (data.epgUrl && !p.epgUrl) {
                                p.epgUrl = data.epgUrl;
                                App.Profile.save(p);
                            }
                            return true;
                        });
                    });
                }

                if (opts.force) { return downloadAndStore(); }

                /* Kalici depoda varsa HIC indirme yapma */
                return App.BigStore.get(key).then(function (packed) {
                    /* Eski surumden kalan localStorage onbellegi de kabul edilir */
                    if (!packed) { packed = App.Cache.get(key); }

                    if (packed) {
                        var restored = App.M3U.unpack(packed);
                        if (restored) {
                            m3uData = restored;
                            log.info('M3U kalici depodan geri yuklendi:',
                                     m3uData.items.length, 'oge (indirme yok)');
                            return true;
                        }
                    }
                    return downloadAndStore();
                }, downloadAndStore);
            }

            return Promise.resolve(false);
        },

        /** Hangi ozellikler destekleniyor */
        supports: function (feature) {
            if (type === 'xtream') { return true; }
            if (type === 'm3u') {
                /* Diziler M3U'da da desteklenir: bolumler baslik kalibindan
                   (S01E05, 1x05, "Sezon 1 Bolum 5") tespit edilip gruplanir. */
                if (feature === 'series') { return !!(m3uData && m3uData.series.length); }
                if (feature === 'movies') { return !!(m3uData && m3uFilter('movie').length); }
                if (feature === 'epg') { return !!(App.Profile.get() && App.Profile.get().epgUrl); }
                return true;
            }
            return false;
        },

        /* ==================== CANLI TV ==================== */

        getLiveCategories: function (force) {
            if (type === 'xtream') {
                return App.Xtream.getLiveCategories(force).then(function (cats) {
                    return [{ id: ALL_ID, name: 'Tum Kanallar' }].concat(cats);
                });
            }
            if (type === 'm3u') {
                return Promise.resolve()
                    .then(function () {
                        return [{ id: ALL_ID, name: 'Tum Kanallar' }].concat(m3uGroupsFor('live'));
                    });
            }
            return Promise.reject(new App.AppError(App.ERR.UNSUPPORTED, 'kaynak yok'));
        },

        getLiveChannels: function (categoryId, force) {
            if (type === 'xtream') {
                var cid = (categoryId === ALL_ID) ? '' : categoryId;
                return App.Xtream.getLiveStreams(cid, force);
            }
            if (type === 'm3u') {
                return Promise.resolve().then(function () { return m3uFilter('live', categoryId); });
            }
            return Promise.reject(new App.AppError(App.ERR.UNSUPPORTED, 'kaynak yok'));
        },

        /* ==================== FILMLER ==================== */

        getMovieCategories: function (force) {
            if (type === 'xtream') {
                return App.Xtream.getVodCategories(force).then(function (cats) {
                    return [{ id: ALL_ID, name: 'Tum Filmler' }].concat(cats);
                });
            }
            if (type === 'm3u') {
                return Promise.resolve().then(function () {
                    var g = m3uGroupsFor('movie');
                    if (!g.length) { return []; }
                    return [{ id: ALL_ID, name: 'Tum Filmler' }].concat(g);
                });
            }
            return Promise.reject(new App.AppError(App.ERR.UNSUPPORTED, 'kaynak yok'));
        },

        getMovies: function (categoryId, force) {
            if (type === 'xtream') {
                var cid = (categoryId === ALL_ID) ? '' : categoryId;
                return App.Xtream.getVodStreams(cid, force);
            }
            if (type === 'm3u') {
                return Promise.resolve().then(function () { return m3uFilter('movie', categoryId); });
            }
            return Promise.reject(new App.AppError(App.ERR.UNSUPPORTED, 'kaynak yok'));
        },

        getMovieInfo: function (item) {
            if (type === 'xtream') { return App.Xtream.getVodInfo(item.id); }
            /* M3U'da detay yoktur - elimizdeki bilgiyi don */
            return Promise.resolve({
                id: item.id, name: item.name, plot: '', cover: item.logo,
                containerExtension: '', durationSecs: 0
            });
        },

        /* ==================== DIZILER ==================== */

        getSeriesCategories: function (force) {
            if (type === 'xtream') {
                return App.Xtream.getSeriesCategories(force).then(function (cats) {
                    return [{ id: ALL_ID, name: 'Tum Diziler' }].concat(cats);
                });
            }
            if (type === 'm3u') {
                return Promise.resolve().then(function () {
                    var g = m3uGroupsFor('series');
                    if (!g.length) { return []; }
                    return [{ id: ALL_ID, name: 'Tum Diziler' }].concat(g);
                });
            }
            return Promise.reject(new App.AppError(App.ERR.UNSUPPORTED, 'kaynak yok'));
        },

        getSeriesList: function (categoryId, force) {
            if (type === 'xtream') {
                var cid = (categoryId === ALL_ID) ? '' : categoryId;
                return App.Xtream.getSeries(cid, force);
            }
            if (type === 'm3u') {
                return Promise.resolve().then(function () { return m3uSeries(categoryId); });
            }
            return Promise.reject(new App.AppError(App.ERR.UNSUPPORTED, 'diziler desteklenmiyor'));
        },

        getSeriesInfo: function (seriesId) {
            if (type === 'xtream') {
                return App.Xtream.getSeriesInfo(seriesId);
            }
            if (type === 'm3u') {
                return Promise.resolve().then(function () {
                    var d = requireM3U();
                    for (var i = 0; i < d.series.length; i++) {
                        if (d.series[i].id === seriesId || d.series[i].key === seriesId) {
                            return d.series[i];
                        }
                    }
                    throw new App.AppError(App.ERR.NOT_FOUND, 'dizi bulunamadi');
                });
            }
            return Promise.reject(new App.AppError(App.ERR.UNSUPPORTED, 'diziler desteklenmiyor'));
        },

        /* ==================== STREAM URL ==================== */

        /**
         * Oynatilacak adresi uretir.
         * @param {object} item  normalize edilmis icerik nesnesi
         * @param {string} [ext] canli yayin icin 'm3u8' | 'ts'
         */
        streamUrl: function (item, ext) {
            if (!item) { return ''; }

            /* M3U ogeleri adresi zaten tasir */
            if (item.url) { return item.url; }

            if (type !== 'xtream') { return ''; }

            if (item.type === 'live') {
                /* Ayarlar > "Tercih Edilen Yayin Formati" burada devreye girer.
                   Acilmazsa player/controller.js altStreamUrl() ile digerini dener. */
                return App.Xtream.liveUrl(item.id, ext || App.Settings.get('preferredFormat') || 'm3u8');
            }
            if (item.type === 'movie') {
                return App.Xtream.movieUrl(item.id, item.containerExtension || 'mp4');
            }
            if (item.type === 'episode') {
                return App.Xtream.episodeUrl(item.id, item.containerExtension || 'mp4');
            }
            return '';
        },

        /** Canli yayin icin alternatif format (m3u8 <-> ts gecisi) */
        altStreamUrl: function (item, currentUrl) {
            if (!item || item.type !== 'live' || type !== 'xtream') { return ''; }
            var isHls = /\.m3u8(\?|$)/i.test(currentUrl || '');
            return App.Xtream.liveUrl(item.id, isHls ? 'ts' : 'm3u8');
        },

        /* ==================== ARAMA ==================== */

        /**
         * @param {string} query
         * @param {string} scope 'live' | 'movie' | 'series' | 'all'
         * @returns {Promise<{live:[], movies:[], series:[]}>}
         */
        search: function (query, scope) {
            var q = U.normalize(query);
            if (q.length < 2) {
                return Promise.resolve({ live: [], movies: [], series: [] });
            }
            scope = scope || 'all';

            function match(list) {
                var out = [];
                for (var i = 0; i < list.length && out.length < 300; i++) {
                    if (U.normalize(list[i].name).indexOf(q) !== -1) { out.push(list[i]); }
                }
                return out;
            }

            var jobs = [];

            if (scope === 'all' || scope === 'live') {
                jobs.push(C.getLiveChannels(ALL_ID).then(match, function () { return []; }));
            } else { jobs.push(Promise.resolve([])); }

            if ((scope === 'all' || scope === 'movie') && C.supports('movies')) {
                jobs.push(C.getMovies(ALL_ID).then(match, function () { return []; }));
            } else { jobs.push(Promise.resolve([])); }

            if ((scope === 'all' || scope === 'series') && C.supports('series')) {
                jobs.push(C.getSeriesList(ALL_ID).then(match, function () { return []; }));
            } else { jobs.push(Promise.resolve([])); }

            return Promise.all(jobs).then(function (r) {
                return { live: r[0], movies: r[1], series: r[2] };
            });
        },

        /* ==================== BAKIM ==================== */

        /** Onbellegi bosalt ve verileri yeniden cek */
        refresh: function (onStatus) {
            App.Cache.invalidate(App.Profile.id());
            m3uData = null;
            return C.init({ force: true, onStatus: onStatus });
        },

        /** Tum kanallarin epg_channel_id listesi (XMLTV filtreleme icin) */
        allEpgChannelIds: function () {
            return C.getLiveChannels(ALL_ID).then(function (list) {
                var ids = [];
                for (var i = 0; i < list.length; i++) {
                    if (list[i].epgChannelId) { ids.push(list[i].epgChannelId); }
                }
                return ids;
            }, function () { return []; });
        },

        /** EPG kaynagi adresi */
        epgUrl: function () {
            var p = App.Profile.get();
            if (!p) { return ''; }
            if (p.epgUrl) { return p.epgUrl; }
            if (type === 'xtream') {
                try { return App.Xtream.xmltvUrl(); } catch (e) { return ''; }
            }
            if (type === 'm3u' && m3uData && m3uData.epgUrl) { return m3uData.epgUrl; }
            return '';
        },

        stats: function () {
            if (type === 'm3u' && m3uData) { return m3uData.stats; }
            return null;
        }
    };

    App.Content = C;
})(window.App = window.App || {});
