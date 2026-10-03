/* ============================================================
   services/xtream.js
   Xtream Codes API istemcisi.

   ENDPOINT SEMASI (standart Xtream Codes / XUI paneller):
     Taban:   http://SERVER:PORT/player_api.php?username=USERNAME&password=PASSWORD
     Aksiyon: &action=<action>[&ek parametreler]

   Kullanilan aksiyonlar:
     (yok)                  -> user_info + server_info  (LOGIN dogrulama)
     get_live_categories    -> canli yayin kategorileri
     get_live_streams       -> kanallar        [&category_id=]
     get_vod_categories     -> film kategorileri
     get_vod_streams        -> filmler         [&category_id=]
     get_vod_info           -> film detayi     &vod_id=
     get_series_categories  -> dizi kategorileri
     get_series             -> diziler         [&category_id=]
     get_series_info        -> sezon/bolum listesi  &series_id=
     get_short_epg          -> kanalin siradaki programlari &stream_id=&limit=
     get_simple_data_table  -> kanalin tam gunluk EPG'si    &stream_id=

   STREAM URL SEMASI:
     Canli : http://SERVER:PORT/live/USERNAME/PASSWORD/STREAM_ID.m3u8   (veya .ts)
     Film  : http://SERVER:PORT/movie/USERNAME/PASSWORD/STREAM_ID.EXT
     Dizi  : http://SERVER:PORT/series/USERNAME/PASSWORD/EPISODE_ID.EXT
     XMLTV : http://SERVER:PORT/xmltv.php?username=USERNAME&password=PASSWORD

   NOT: Bu dosyada hicbir gercek sunucu adresi veya kullanici bilgisi
   YOKTUR. Tum degerler kullanicinin giris ekranindan gelir.
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('Xtream');
    var U = App.Utils;

    var cfg = { host: '', username: '', password: '' };

    function ensureConfigured() {
        if (!cfg.host || !cfg.username) {
            throw new App.AppError(App.ERR.AUTH, 'Xtream yapilandirilmamis');
        }
    }

    /** player_api.php URL'i uretir */
    function apiUrl(action, extra) {
        var params = Object.assign({
            username: cfg.username,
            password: cfg.password
        }, extra || {});
        if (action) { params.action = action; }
        return cfg.host + '/player_api.php?' + U.buildQuery(params);
    }

    /**
     * API cagrisi. Xtream panelleri hatada bazen
     *   {"user_info":{"auth":0}}  bazen  []  bazen  false  dondurur.
     */
    function call(action, extra, opts) {
        ensureConfigured();
        var url = apiUrl(action, extra);
        return App.Http.getJson(url, Object.assign({ timeout: 25000, retries: 1 }, opts || {}))
            .then(function (data) {
                if (data === false || data === null) {
                    throw new App.AppError(App.ERR.EMPTY, action + ' bos dondu');
                }
                return data;
            });
    }

    var X = {
        /** Giris bilgilerini ayarla (Profile'dan gelir) */
        configure: function (p) {
            cfg.host = U.normalizeHost(p.host);
            cfg.username = p.username || '';
            cfg.password = p.password || '';
            log.info('yapilandirildi:', cfg.host, '| kullanici:', cfg.username);
            return cfg;
        },

        getConfig: function () { return Object.assign({}, cfg); },
        isConfigured: function () { return !!(cfg.host && cfg.username); },

        /* ==================== LOGIN ==================== */

        /**
         * Kimlik dogrulama. Basarili olursa {userInfo, serverInfo} doner.
         * Hatalarda AppError firlatir (AUTH / EXPIRED / NETWORK ...).
         */
        login: function () {
            return call(null, null, { timeout: 20000, retries: 1 }).then(function (data) {
                var ui = data && data.user_info;
                var si = (data && data.server_info) || {};

                if (!ui) {
                    throw new App.AppError(App.ERR.PARSE, 'user_info alani yok');
                }
                /* auth: 1 = basarili, 0 = hatali kullanici/sifre */
                if (String(ui.auth) !== '1') {
                    throw new App.AppError(App.ERR.AUTH, 'auth=' + ui.auth);
                }
                /* status: Active / Expired / Banned / Disabled */
                var st = String(ui.status || '').toLowerCase();
                if (st && st !== 'active') {
                    throw new App.AppError(App.ERR.EXPIRED, 'status=' + ui.status);
                }

                var expDate = U.parseDate(ui.exp_date);
                var info = {
                    username: ui.username || cfg.username,
                    status: ui.status || 'Active',
                    isTrial: String(ui.is_trial) === '1',
                    activeConnections: U.toInt(ui.active_cons, 0),
                    maxConnections: U.toInt(ui.max_connections, 0),
                    createdAt: U.parseDate(ui.created_at),
                    expiresAt: expDate,
                    expiresText: expDate ? U.ddmmyyyy(expDate) : 'Sinirsiz',
                    daysLeft: expDate ? Math.ceil((expDate.getTime() - Date.now()) / 86400000) : null,
                    allowedFormats: U.arr(ui.allowed_output_formats),
                    serverUrl: si.url || '',
                    serverPort: si.port || '',
                    httpsPort: si.https_port || '',
                    serverProtocol: si.server_protocol || 'http',
                    timezone: si.timezone || ''
                };
                log.info('giris basarili:', info.username, '| bitis:', info.expiresText);
                return { userInfo: info, raw: data };
            });
        },

        /* ==================== CANLI YAYIN ==================== */

        getLiveCategories: function (force) {
            return App.Cache.wrap(App.Profile.key('live.cats'), App.Cache.TTL.LONG, function () {
                return call('get_live_categories').then(normalizeCategories);
            }, { force: force });
        },

        /**
         * @param {string|number} categoryId  bos birakilirsa TUM kanallar
         */
        getLiveStreams: function (categoryId, force) {
            var key = App.Profile.key('live.streams.' + (categoryId || 'all'));
            return App.Cache.wrap(key, App.Cache.TTL.MEDIUM, function () {
                return call('get_live_streams', categoryId ? { category_id: categoryId } : null)
                    .then(function (raw) { return normalizeLive(raw); });
            }, { force: force, persist: true });
        },

        /* ==================== FILMLER (VOD) ==================== */

        getVodCategories: function (force) {
            return App.Cache.wrap(App.Profile.key('vod.cats'), App.Cache.TTL.LONG, function () {
                return call('get_vod_categories').then(normalizeCategories);
            }, { force: force });
        },

        getVodStreams: function (categoryId, force) {
            var key = App.Profile.key('vod.streams.' + (categoryId || 'all'));
            return App.Cache.wrap(key, App.Cache.TTL.MEDIUM, function () {
                return call('get_vod_streams', categoryId ? { category_id: categoryId } : null)
                    .then(normalizeMovies);
            }, { force: force });
        },

        /** Film detayi: sure, ozet, oyuncular, yonetmen, kapak */
        getVodInfo: function (vodId) {
            var key = App.Profile.key('vod.info.' + vodId);
            return App.Cache.wrap(key, App.Cache.TTL.DAY, function () {
                return call('get_vod_info', { vod_id: vodId }).then(function (d) {
                    var i = (d && d.info) || {};
                    var m = (d && d.movie_data) || {};
                    return {
                        id: m.stream_id || vodId,
                        name: m.name || i.name || '',
                        plot: i.plot || i.description || '',
                        cast: i.cast || i.actors || '',
                        director: i.director || '',
                        genre: i.genre || '',
                        releaseDate: i.releasedate || i.release_date || '',
                        rating: i.rating || '',
                        durationSecs: U.toInt(i.duration_secs, 0),
                        duration: i.duration || '',
                        cover: i.movie_image || i.cover_big || '',
                        backdrop: (U.arr(i.backdrop_path)[0]) || '',
                        containerExtension: m.container_extension || 'mp4',
                        video: i.video || null,
                        audio: i.audio || null
                    };
                });
            });
        },

        /* ==================== DIZILER ==================== */

        getSeriesCategories: function (force) {
            return App.Cache.wrap(App.Profile.key('series.cats'), App.Cache.TTL.LONG, function () {
                return call('get_series_categories').then(normalizeCategories);
            }, { force: force });
        },

        getSeries: function (categoryId, force) {
            var key = App.Profile.key('series.list.' + (categoryId || 'all'));
            return App.Cache.wrap(key, App.Cache.TTL.MEDIUM, function () {
                return call('get_series', categoryId ? { category_id: categoryId } : null)
                    .then(normalizeSeries);
            }, { force: force });
        },

        /** Sezonlar + bolumler */
        getSeriesInfo: function (seriesId) {
            var key = App.Profile.key('series.info.' + seriesId);
            return App.Cache.wrap(key, App.Cache.TTL.DAY, function () {
                return call('get_series_info', { series_id: seriesId }).then(function (d) {
                    return normalizeSeriesInfo(d, seriesId);
                });
            });
        },

        /* ==================== EPG ==================== */

        /**
         * Kanalin siradaki N programi.
         * Baslik ve aciklama BASE64 kodludur -> cozuluyor.
         */
        getShortEpg: function (streamId, limit) {
            return call('get_short_epg', { stream_id: streamId, limit: limit || 6 },
                        { timeout: 12000, retries: 0 })
                .then(function (d) {
                    var list = U.arr(d && d.epg_listings);
                    return list.map(mapEpgEntry).filter(function (x) { return !!x; });
                });
        },

        /** Kanalin tam gun EPG tablosu (bazi panellerde get_short_epg yerine bu calisir) */
        getFullEpg: function (streamId) {
            return call('get_simple_data_table', { stream_id: streamId },
                        { timeout: 15000, retries: 0 })
                .then(function (d) {
                    var list = U.arr(d && d.epg_listings);
                    return list.map(mapEpgEntry).filter(function (x) { return !!x; });
                });
        },

        /** Tum kanallarin XMLTV EPG dosyasi (buyuk olabilir - dikkatli kullanin) */
        xmltvUrl: function () {
            ensureConfigured();
            return cfg.host + '/xmltv.php?' + U.buildQuery({
                username: cfg.username, password: cfg.password
            });
        },

        /* ==================== STREAM URL URETIMI ==================== */

        /**
         * Canli yayin URL'i.
         * @param {number|string} streamId
         * @param {string} [ext] 'm3u8' (HLS, varsayilan) veya 'ts' (MPEG-TS)
         *
         * AVPlay her ikisini de oynatir. HLS daha uyumlu, TS daha dusuk
         * gecikmelidir. Bir format acilmazsa player/controller.js otomatik
         * digerini dener.
         */
        liveUrl: function (streamId, ext) {
            ensureConfigured();
            return cfg.host + '/live/' + encodeURIComponent(cfg.username) + '/' +
                   encodeURIComponent(cfg.password) + '/' + streamId + '.' + (ext || 'm3u8');
        },

        movieUrl: function (streamId, ext) {
            ensureConfigured();
            return cfg.host + '/movie/' + encodeURIComponent(cfg.username) + '/' +
                   encodeURIComponent(cfg.password) + '/' + streamId + '.' + (ext || 'mp4');
        },

        episodeUrl: function (episodeId, ext) {
            ensureConfigured();
            return cfg.host + '/series/' + encodeURIComponent(cfg.username) + '/' +
                   encodeURIComponent(cfg.password) + '/' + episodeId + '.' + (ext || 'mp4');
        },

        /** Hata ayiklama icin (sifre maskelenir) */
        debugUrl: function (action) {
            return apiUrl(action, null).replace(/password=[^&]*/, 'password=***');
        }
    };

    /* ==================== NORMALIZASYON ====================
       Farkli panel surumleri alan adlarini degistirebiliyor.
       Uygulamanin geri kalani DAIMA ayni sekli gorur. */

    function normalizeCategories(raw) {
        var arr = U.arr(raw);
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            var c = arr[i];
            if (!c) { continue; }
            var id = c.category_id !== undefined ? String(c.category_id) : String(c.id || '');
            var name = c.category_name || c.name || ('Kategori ' + id);
            if (!id) { continue; }
            out.push({ id: id, name: String(name).trim(), parentId: c.parent_id || 0 });
        }
        return out;
    }

    function normalizeLive(raw) {
        var arr = U.arr(raw);
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            var s = arr[i];
            if (!s) { continue; }
            var id = s.stream_id !== undefined ? s.stream_id : s.id;
            if (id === undefined || id === null) { continue; }
            out.push({
                key: 'live:' + id,
                type: 'live',
                id: id,
                name: String(s.name || 'Kanal ' + id).trim(),
                logo: s.stream_icon || '',
                num: U.toInt(s.num, i + 1),
                categoryId: s.category_id !== undefined ? String(s.category_id) : '',
                epgChannelId: s.epg_channel_id || '',
                tvArchive: U.toInt(s.tv_archive, 0) === 1,
                archiveDuration: U.toInt(s.tv_archive_duration, 0),
                added: s.added || ''
            });
        }
        return out;
    }

    function normalizeMovies(raw) {
        var arr = U.arr(raw);
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            var s = arr[i];
            if (!s) { continue; }
            var id = s.stream_id !== undefined ? s.stream_id : s.id;
            if (id === undefined || id === null) { continue; }
            out.push({
                key: 'movie:' + id,
                type: 'movie',
                id: id,
                name: String(s.name || 'Film ' + id).trim(),
                logo: s.stream_icon || s.cover || '',
                categoryId: s.category_id !== undefined ? String(s.category_id) : '',
                rating: s.rating || s.rating_5based || '',
                containerExtension: s.container_extension || 'mp4',
                added: s.added || '',
                num: U.toInt(s.num, i + 1)
            });
        }
        return out;
    }

    function normalizeSeries(raw) {
        var arr = U.arr(raw);
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            var s = arr[i];
            if (!s) { continue; }
            var id = s.series_id !== undefined ? s.series_id : s.id;
            if (id === undefined || id === null) { continue; }
            out.push({
                key: 'series:' + id,
                type: 'series',
                id: id,
                name: String(s.name || 'Dizi ' + id).trim(),
                logo: s.cover || s.stream_icon || '',
                categoryId: s.category_id !== undefined ? String(s.category_id) : '',
                plot: s.plot || '',
                cast: s.cast || '',
                director: s.director || '',
                genre: s.genre || '',
                rating: s.rating || '',
                releaseDate: s.releaseDate || s.release_date || '',
                lastModified: s.last_modified || ''
            });
        }
        return out;
    }

    function normalizeSeriesInfo(d, seriesId) {
        var info = (d && d.info) || {};
        var epsRaw = (d && d.episodes) || {};
        var seasonsRaw = U.arr(d && d.seasons);

        /* episodes: { "1": [ {...}, ... ], "2": [...] } */
        var seasons = [];
        var keys = [];
        for (var k in epsRaw) {
            if (Object.prototype.hasOwnProperty.call(epsRaw, k)) { keys.push(k); }
        }
        keys.sort(function (a, b) { return U.toInt(a, 0) - U.toInt(b, 0); });

        for (var i = 0; i < keys.length; i++) {
            var sn = keys[i];
            var list = U.arr(epsRaw[sn]);
            var eps = [];
            for (var j = 0; j < list.length; j++) {
                var e = list[j];
                if (!e) { continue; }
                var ei = (e.info) || {};
                eps.push({
                    key: 'episode:' + e.id,
                    type: 'episode',
                    id: e.id,
                    seriesId: seriesId,
                    seriesName: info.name || '',
                    season: U.toInt(sn, 0),
                    episodeNum: U.toInt(e.episode_num, j + 1),
                    name: String(e.title || ('Bolum ' + (j + 1))).trim(),
                    containerExtension: e.container_extension || 'mp4',
                    plot: ei.plot || ei.overview || '',
                    durationSecs: U.toInt(ei.duration_secs, 0),
                    duration: ei.duration || '',
                    logo: ei.movie_image || info.cover || '',
                    rating: ei.rating || '',
                    added: e.added || ''
                });
            }
            eps.sort(function (a, b) { return a.episodeNum - b.episodeNum; });

            var meta = null;
            for (var s2 = 0; s2 < seasonsRaw.length; s2++) {
                if (U.toInt(seasonsRaw[s2].season_number, -1) === U.toInt(sn, -2)) { meta = seasonsRaw[s2]; }
            }
            seasons.push({
                number: U.toInt(sn, 0),
                name: (meta && meta.name) || ('Sezon ' + sn),
                cover: (meta && (meta.cover || meta.cover_big)) || info.cover || '',
                overview: (meta && meta.overview) || '',
                episodes: eps
            });
        }

        return {
            id: seriesId,
            name: info.name || '',
            plot: info.plot || '',
            cast: info.cast || '',
            director: info.director || '',
            genre: info.genre || '',
            releaseDate: info.releaseDate || info.release_date || '',
            rating: info.rating || '',
            cover: info.cover || '',
            backdrop: (U.arr(info.backdrop_path)[0]) || '',
            seasons: seasons,
            episodeCount: seasons.reduce(function (n, s) { return n + s.episodes.length; }, 0)
        };
    }

    /** Xtream EPG kaydi -> {start, stop, title, desc} */
    function mapEpgEntry(e) {
        if (!e) { return null; }
        var start = U.parseDate(e.start_timestamp) || U.parseDate(e.start);
        var stop = U.parseDate(e.stop_timestamp) || U.parseDate(e.end) || U.parseDate(e.stop);
        if (!start) { return null; }
        return {
            start: start,
            stop: stop,
            title: U.b64decode(e.title) || 'Program bilgisi yok',
            desc: U.b64decode(e.description || e.descr || ''),
            channelId: e.channel_id || '',
            hasArchive: U.toInt(e.has_archive, 0) === 1
        };
    }

    X._normalizeCategories = normalizeCategories;
    App.Xtream = X;
})(window.App = window.App || {});
