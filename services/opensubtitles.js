/* ============================================================
   services/opensubtitles.js
   OpenSubtitles REST API istemcisi (api.opensubtitles.com/api/v1)

   NE ISE YARAR?
   Kaynaktaki gomulu altyazi bozuk, eksik veya goruntu tabanliysa
   (DVB-SUB / PGS - AVPlay bunlari metin olarak vermez) dizinin adi
   ve sezon/bolum numarasiyla internetten .srt indirip oynaticida
   gostermeyi saglar.

   KULLANICININ SAGLAMASI GEREKENLER
     1) Ucretsiz OpenSubtitles hesabi   -> https://www.opensubtitles.com
     2) Kendi API anahtari              -> Hesap > API Consumers > New

   API ANAHTARI KODA GOMULMEZ. Sebep:
     - Servisin kullanim sartlari her uygulamanin kendi anahtarini
       kullanmasini gerektirir,
     - Indirme kotasi anahtarin/hesabin sahibine yazilir.
   Anahtar ve hesap bilgileri yalnizca bu televizyonda saklanir.

   AKIS
     POST /login              -> token (indirme icin gerekli)
     GET  /subtitles?...      -> arama sonuclari (yalnizca Api-Key yeter)
     POST /download {file_id} -> gecici indirme baglantisi
     GET  <link>              -> .srt icerigi

   NOT: Ucretsiz kotada gunluk indirme sinirlidir; kalan hak
   /download yanitindaki "remaining" alaninda doner ve kullaniciya
   gosterilir.
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('OpenSubs');
    var U = App.Utils;

    var BASE = 'https://api.opensubtitles.com/api/v1';
    var UA = 'IPTVPlayerTizen v1.0';

    var K_KEY = 'os.apiKey';
    var K_USER = 'os.username';
    var K_PASS = 'os.password';
    var K_TOKEN = 'os.token';

    function apiKey() { return App.Storage.get(K_KEY, '') || ''; }
    function username() { return App.Storage.get(K_USER, '') || ''; }
    function password() { return App.Storage.getSecret(K_PASS) || ''; }

    function headers(extra) {
        var h = {
            'Api-Key': apiKey(),
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            /* Servis kendi kurallari geregi uygulama adi ister */
            'User-Agent': UA
        };
        if (extra) {
            for (var k in extra) {
                if (Object.prototype.hasOwnProperty.call(extra, k)) { h[k] = extra[k]; }
            }
        }
        return h;
    }

    function requireKey() {
        if (!apiKey()) {
            throw new App.AppError(App.ERR.AUTH,
                'OpenSubtitles API anahtari girilmemis');
        }
    }

    /** Kayitli oturum jetonu (24 saat gecerli sayilir) */
    function cachedToken() {
        var rec = App.Storage.get(K_TOKEN, null);
        if (!rec || !rec.token) { return null; }
        if (rec.at && (Date.now() - rec.at) > 20 * 60 * 60 * 1000) { return null; }
        return rec.token;
    }

    var OS = {
        /* ---------------- Yapilandirma ---------------- */

        isConfigured: function () { return !!apiKey(); },
        hasAccount: function () { return !!(username() && password()); },

        getConfig: function () {
            return {
                apiKey: apiKey(),
                username: username(),
                password: password(),
                language: App.Settings.get('subtitleSearchLang') || 'tr'
            };
        },

        saveConfig: function (cfg) {
            App.Storage.set(K_KEY, (cfg.apiKey || '').trim());
            App.Storage.set(K_USER, (cfg.username || '').trim());
            App.Storage.setSecret(K_PASS, cfg.password || '');
            App.Storage.remove(K_TOKEN);      /* bilgiler degisti -> jetonu at */
            if (cfg.language) { App.Settings.set('subtitleSearchLang', cfg.language); }
            log.info('OpenSubtitles yapilandirmasi kaydedildi');
        },

        clearConfig: function () {
            App.Storage.remove(K_KEY);
            App.Storage.remove(K_USER);
            App.Storage.remove(K_PASS);
            App.Storage.remove(K_TOKEN);
        },

        /* ---------------- Oturum ---------------- */

        /**
         * Indirme icin gereken jetonu alir (varsa onbellekten).
         * @returns {Promise<string>}
         */
        login: function (force) {
            requireKey();

            if (!force) {
                var t = cachedToken();
                if (t) { return Promise.resolve(t); }
            }
            if (!OS.hasAccount()) {
                return Promise.reject(new App.AppError(App.ERR.AUTH,
                    'OpenSubtitles kullanici adi/sifresi girilmemis'));
            }

            return App.Http.request(BASE + '/login', {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({ username: username(), password: password() }),
                timeout: 20000,
                retries: 0
            }).then(function (res) {
                var d;
                try { d = JSON.parse(res.text); }
                catch (e) { throw new App.AppError(App.ERR.PARSE, 'login yaniti okunamadi'); }

                if (!d || !d.token) {
                    throw new App.AppError(App.ERR.AUTH, 'jeton alinamadi');
                }
                App.Storage.trySet(K_TOKEN, { token: d.token, at: Date.now() });
                log.info('OpenSubtitles oturumu acildi');
                return d.token;
            });
        },

        /* ---------------- Arama ---------------- */

        /**
         * @param {object} q {query, season, episode, year, languages}
         * @returns {Promise<Array>} normalize edilmis sonuclar
         */
        search: function (q) {
            requireKey();

            var params = {
                query: (q.query || '').trim(),
                languages: q.languages || App.Settings.get('subtitleSearchLang') || 'tr',
                order_by: 'download_count',
                order_direction: 'desc'
            };
            if (q.season) { params.season_number = q.season; }
            if (q.episode) { params.episode_number = q.episode; }
            if (q.year) { params.year = q.year; }
            if (q.season || q.episode) { params.type = 'episode'; }

            var url = BASE + '/subtitles?' + U.buildQuery(params);
            log.info('arama:', params.query,
                     params.season_number ? ('S' + params.season_number + 'B' + params.episode_number) : '',
                     '| dil:', params.languages);

            return App.Http.request(url, {
                method: 'GET',
                headers: headers(),
                timeout: 25000,
                retries: 1
            }).then(function (res) {
                var d;
                try { d = JSON.parse(res.text); }
                catch (e) { throw new App.AppError(App.ERR.PARSE, 'arama yaniti okunamadi'); }
                return normalizeResults(d);
            });
        },

        /* ---------------- Indirme ---------------- */

        /**
         * Altyazi dosyasini indirir.
         * @param {number|string} fileId  arama sonucundaki fileId
         * @returns {Promise<{text, fileName, remaining}>}
         */
        download: function (fileId) {
            requireKey();

            /* HESAP ZORUNLU DEGILDIR.
               - Hesap girilmisse: once /login ile jeton alinir; gunluk indirme
                 kotasi hesaba yazilir ve daha yuksektir.
               - Hesap girilmemisse: yalnizca Api-Key ile indirilir; servis
                 daha kucuk bir anonim kota uygular.
               Boylece kullanicinin tek yapmasi gereken API anahtarini girmektir. */
            var step = OS.hasAccount()
                ? OS.login().then(function (token) { return { 'Authorization': 'Bearer ' + token }; },
                                  function () { return null; })   /* login basarisizsa anonim dene */
                : Promise.resolve(null);

            return step.then(function (auth) {
                return App.Http.request(BASE + '/download', {
                    method: 'POST',
                    headers: headers(auth),
                    body: JSON.stringify({ file_id: fileId, sub_format: 'srt' }),
                    timeout: 25000,
                    retries: 0
                });
            }).then(function (res) {
                var d;
                try { d = JSON.parse(res.text); }
                catch (e) { throw new App.AppError(App.ERR.PARSE, 'indirme yaniti okunamadi'); }

                if (!d || !d.link) {
                    var msg = (d && d.message) || 'indirme baglantisi alinamadi';
                    /* Kota dolduysa servis bunu mesajda bildirir */
                    if (/quota|limit/i.test(msg)) {
                        throw new App.AppError(App.ERR.HTTP,
                            'gunluk indirme kotasi doldu' +
                            (OS.hasAccount() ? '' : ' (hesap girerseniz kota artar)') +
                            ': ' + msg);
                    }
                    throw new App.AppError(App.ERR.HTTP, msg);
                }

                var remaining = (d.remaining !== undefined) ? d.remaining : null;
                var fileName = d.file_name || 'altyazi.srt';

                /* Dosyanin kendisi ayri bir adresten cekilir (Api-Key gerekmez) */
                return App.Http.getText(d.link, { timeout: 30000, retries: 1 })
                    .then(function (text) {
                        if (!text || text.length < 20) {
                            throw new App.AppError(App.ERR.EMPTY, 'altyazi dosyasi bos');
                        }
                        log.info('altyazi indirildi:', fileName,
                                 '| kalan hak:', remaining);
                        return { text: text, fileName: fileName, remaining: remaining };
                    });
            });
        },

        /**
         * Bir icerik nesnesinden arama parametreleri uretir.
         * Bolumlerde dizi adi + sezon/bolum, filmlerde ad + yil kullanilir.
         */
        queryFor: function (item, fallbackTitle) {
            if (!item) { return null; }

            if (item.type === 'episode') {
                /* Sirasiyla: ogenin dizi adi -> disaridan verilen ad ->
                   ogenin kendi adi. Sonuncusu cogu zaman "Bolum 1" gibi
                   yalnizca bolum etiketidir; o durumda arama YAPILMAZ. */
                var name = item.seriesName || fallbackTitle || item.name || '';
                var q = cleanTitle(name);

                if (!q || isEpisodeLabelOnly(q)) {
                    return { query: '', reason: 'noTitle',
                             season: U.toInt(item.season, 0) || undefined,
                             episode: U.toInt(item.episodeNum, 0) || undefined };
                }

                return {
                    query: q,
                    season: U.toInt(item.season, 0) || undefined,
                    episode: U.toInt(item.episodeNum, 0) || undefined
                };
            }

            if (item.type === 'movie') {
                var raw = item.name || '';
                var year = null;
                var ym = /\((\d{4})\)|\b(19|20)\d{2}\b/.exec(raw);
                if (ym) { year = U.toInt(ym[1] || ym[0], 0) || null; }
                return { query: cleanTitle(raw), year: year || undefined };
            }

            /* Canli yayinda anlamli bir arama yapilamaz */
            return null;
        }
    };

    /**
     * Metin YALNIZCA bir bolum etiketi mi? ("Bolum 1", "S01E02", "3")
     * Boyle bir metinle arama yapmak anlamsizdir; dizi adi gerekir.
     */
    function isEpisodeLabelOnly(t) {
        var x = String(t || '').trim();
        if (!x) { return true; }
        if (/^\d+$/.test(x)) { return true; }
        if (/^s\s*\d{1,2}\s*(e\s*\d{1,3})?$/i.test(x)) { return true; }
        if (/^(b[oö]l[uü]m|episode|ep|part|k[ıi]s[ıi]m|sezon|season)\s*\d*$/i.test(x)) { return true; }
        if (/^(b[oö]l[uü]m|episode|ep)\s*\d+\s*s\s*\d+$/i.test(x)) { return true; }
        return false;
    }

    /** Baslikta kalite/kaynak etiketlerini temizle: arama isabetini artirir */
    function cleanTitle(s) {
        return String(s || '')
            .replace(/\((\d{4})\)/g, ' ')
            .replace(/\b(1080p?|720p?|480p?|2160p?|4k|uhd|fhd|hd|sd|web-?dl|webrip|bluray|brrip|hdtv|x26[45]|hevc|aac|ac3|dual|tr|turkce|altyazi|dublaj)\b/gi, ' ')
            .replace(/[._]+/g, ' ')
            .replace(/[\[\]\(\)]/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    /** API yanitini ekranda gosterilebilir sade bir listeye cevirir */
    function normalizeResults(d) {
        var arr = U.arr(d && d.data);
        var out = [];

        for (var i = 0; i < arr.length; i++) {
            var it = arr[i];
            var a = (it && it.attributes) || {};
            var files = U.arr(a.files);
            if (!files.length) { continue; }

            var fd = a.feature_details || {};
            out.push({
                fileId: files[0].file_id,
                fileName: files[0].file_name || '',
                language: a.language || '',
                release: a.release || files[0].file_name || '',
                downloads: U.toInt(a.download_count, 0),
                rating: a.ratings || 0,
                hearingImpaired: !!a.hearing_impaired,
                fromTrusted: !!a.from_trusted,
                aiTranslated: !!a.ai_translated,
                machineTranslated: !!a.machine_translated,
                season: fd.season_number || null,
                episode: fd.episode_number || null,
                title: fd.title || fd.movie_name || '',
                year: fd.year || null,
                uploadDate: a.upload_date || ''
            });
        }

        /* Once guvenilir/insan cevirisi, sonra indirme sayisi */
        out.sort(function (x, y) {
            var sx = (x.fromTrusted ? 2 : 0) + (x.aiTranslated || x.machineTranslated ? -1 : 1);
            var sy = (y.fromTrusted ? 2 : 0) + (y.aiTranslated || y.machineTranslated ? -1 : 1);
            if (sx !== sy) { return sy - sx; }
            return y.downloads - x.downloads;
        });

        return out.slice(0, 25);
    }

    OS._cleanTitle = cleanTitle;
    OS._isEpisodeLabelOnly = isEpisodeLabelOnly;
    OS._normalize = normalizeResults;

    App.OpenSubtitles = OS;
})(window.App = window.App || {});
