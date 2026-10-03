/* ============================================================
   services/subtitles.js
   HARICI ALTYAZI (SRT / WebVTT) cozumleyici ve zaman cizelgesi.

   NEDEN GEREKLI?
   IPTV kaynaklarindaki gomulu altyazilar bazen bozuk, eksik veya
   goruntu tabanlidir (DVB-SUB / PGS) - AVPlay bunlari metin olarak
   vermez. Bu modul, disaridan indirilen bir .srt/.vtt dosyasini
   cozumler ve oynatma konumuna gore hangi satirin gosterilecegini
   soyler. Cizim isi views/player.js icindeki .subtitle katmanindadir.

   DESTEKLENEN BICIMLER
     SRT   00:00:01,000 --> 00:00:04,000
     VTT   00:00:01.000 --> 00:00:04.000  (WEBVTT basligi ve cue
                                           ayarlari yok sayilir)

   GECIKME AYARI
   Indirilen altyazi ile yayin her zaman ayni kesimden gelmez.
   setOffset(ms) tum zamanlari kaydirir:
     ARTI deger -> altyazi GECIKIR   (erken geliyorsa kullanilir)
     EKSI deger -> altyazi ERKENE alinir (gec geliyorsa kullanilir)
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('Subs');
    var U = App.Utils;

    var cues = [];          /* [{s:baslangicMs, e:bitisMs, t:metin}] siralanmis */
    var offsetMs = 0;
    var meta = null;        /* {name, language, count} */
    var lastIndex = 0;      /* ardisik aramalarda hizlandirma */

    /** "00:01:02,345" | "00:01:02.345" | "1:02.34" -> ms */
    function toMs(str) {
        var m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*$/.exec(str);
        if (!m) { return -1; }
        var h = U.toInt(m[1], 0);
        var mi = U.toInt(m[2], 0);
        var s = U.toInt(m[3], 0);
        var ms = m[4];
        while (ms.length < 3) { ms += '0'; }
        return ((h * 3600 + mi * 60 + s) * 1000) + U.toInt(ms, 0);
    }

    /** Bicimlendirme etiketlerini temizle */
    function cleanText(t) {
        return String(t || '')
            .replace(/\{\\[^}]*\}/g, '')      /* ASS/SSA suslu parantez komutlari */
            .replace(/<\/?[^>]+>/g, '')       /* <i> <b> <font ...> */
            .replace(/\r/g, '')
            .replace(/\n{2,}/g, '\n')
            .trim();
    }

    var S = {
        /**
         * Metni cozumler ve etkin altyazi olarak yukler.
         * @param {string} text
         * @param {object} [info] {name, language}
         * @returns {number} bulunan satir sayisi
         */
        load: function (text, info) {
            var parsed = S.parse(text);
            if (!parsed.length) {
                throw new App.AppError(App.ERR.PARSE, 'altyazi dosyasinda satir bulunamadi');
            }
            cues = parsed;
            lastIndex = 0;
            offsetMs = 0;
            meta = {
                name: (info && info.name) || '',
                language: (info && info.language) || '',
                count: cues.length
            };
            log.info('harici altyazi yuklendi:', cues.length, 'satir');
            App.Bus.emit('subtitles:loaded', meta);
            return cues.length;
        },

        /**
         * SRT / VTT cozumleyici.
         * @returns {Array<{s,e,t}>}
         */
        parse: function (text) {
            if (!text || typeof text !== 'string') { return []; }

            /* BOM ve satir sonlarini normalize et */
            var body = text.replace(/^﻿/, '').replace(/\r\n|\r/g, '\n');

            var out = [];
            /* Zaman satirini yakala; ustundeki sira numarasi opsiyoneldir. */
            var re = /(\d{1,2}:\d{1,2}:\d{1,2}[,.]\d{1,3}|\d{1,2}:\d{1,2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{1,2}:\d{1,2}[,.]\d{1,3}|\d{1,2}:\d{1,2}[,.]\d{1,3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|\n\s*\d+\s*\n\d{1,2}:|$)/g;

            var m;
            while ((m = re.exec(body)) !== null) {
                var s = toMs(m[1]);
                var e = toMs(m[2]);
                if (s < 0 || e < 0) { continue; }

                var t = cleanText(m[3]);
                /* Bir sonraki blogun sira numarasi metne karismis olabilir */
                t = t.replace(/\n\s*\d+\s*$/, '').trim();
                if (!t) { continue; }

                if (e <= s) { e = s + 2000; }
                out.push({ s: s, e: e, t: t });
            }

            out.sort(function (a, b) { return a.s - b.s; });
            return out;
        },

        /** Etkin harici altyazi var mi? */
        isActive: function () { return cues.length > 0; },

        info: function () { return meta ? Object.assign({}, meta, { offset: offsetMs }) : null; },

        clear: function () {
            cues = [];
            meta = null;
            offsetMs = 0;
            lastIndex = 0;
            App.Bus.emit('subtitles:cleared');
        },

        /**
         * Verilen oynatma konumunda gosterilecek metin.
         * @param {number} positionMs
         * @returns {string} yoksa bos dizge
         */
        textAt: function (positionMs) {
            if (!cues.length) { return ''; }
            var p = positionMs - offsetMs;

            /* Ileri dogru normal oynatmada komsu satirlari kontrol etmek
               ikili aramadan cok daha ucuzdur. */
            var i = lastIndex;
            if (i >= cues.length) { i = cues.length - 1; }
            if (i < 0) { i = 0; }

            if (cues[i].s <= p && p < cues[i].e) { return cues[i].t; }
            if (i + 1 < cues.length && cues[i + 1].s <= p && p < cues[i + 1].e) {
                lastIndex = i + 1;
                return cues[i + 1].t;
            }

            /* Atlama/sarma sonrasi ikili arama */
            var lo = 0, hi = cues.length - 1, found = -1;
            while (lo <= hi) {
                var mid = (lo + hi) >> 1;
                if (cues[mid].e <= p) { lo = mid + 1; }
                else if (cues[mid].s > p) { hi = mid - 1; }
                else { found = mid; break; }
            }
            if (found === -1) { lastIndex = Math.max(0, lo - 1); return ''; }
            lastIndex = found;
            return cues[found].t;
        },

        /** Gecikme ayari (ms): + altyaziyi geciktirir, - erkene alir */
        setOffset: function (ms) {
            offsetMs = U.toInt(ms, 0);
            lastIndex = 0;
            App.Bus.emit('subtitles:offset', offsetMs);
            return offsetMs;
        },
        addOffset: function (deltaMs) { return S.setOffset(offsetMs + deltaMs); },
        getOffset: function () { return offsetMs; },

        count: function () { return cues.length; }
    };


    /* ============================================================
       ALTYAZI ONBELLEGI

       Indirilen her altyazi CIHAZDA saklanir. Ayni bolum tekrar
       acildiginda internetten YENIDEN INDIRILMEZ; boylece
       OpenSubtitles gunluk indirme hakki bir daha harcanmaz.

       Depolama: IndexedDB (App.BigStore). Bir sezonluk altyazi
       2-3 MB tutabilir; localStorage kotasi buna yetmez.
       Kucuk bir dizin (hangi anahtar, ne zaman, kac bayt)
       localStorage'da tutulur ki boyut gosterilebilsin ve
       temizleme yapilabilsin.

       Anahtar: dizi adi | sezon | bolum | dil  (normalize edilmis)
                filmlerde: ad | yil | dil
       Dosya adina degil ICERIK KIMLIGINE baglidir; kaynak
       degisse bile ayni bolum ayni altyaziyi bulur.
       ============================================================ */
    var CACHE_PREFIX = 'sub.';
    var IDX_KEY = 'subs.index';

    function idxLoad() { return App.Storage.get(IDX_KEY, {}) || {}; }
    function idxSave(o) { App.Storage.trySet(IDX_KEY, o); }

    var SC = {
        /**
         * Icerik icin onbellek anahtari.
         * @returns {string|null} uretilemezse null
         */
        keyFor: function (item, lang) {
            if (!item) { return null; }
            lang = String(lang || App.Settings.get('subtitleSearchLang') || 'tr').toLowerCase();

            if (item.type === 'episode') {
                var name = item.seriesName || '';
                if (!name) { return null; }
                return U.hash(U.normalize(name)) + '.s' + U.toInt(item.season, 0) +
                       'e' + U.toInt(item.episodeNum, 0) + '.' + lang;
            }
            if (item.type === 'movie') {
                if (!item.name) { return null; }
                return 'm' + U.hash(U.normalize(item.name)) + '.' + lang;
            }
            return null;
        },

        /** @returns {Promise<object|null>} {text, name, language, at} */
        get: function (item, lang) {
            var k = SC.keyFor(item, lang);
            if (!k) { return Promise.resolve(null); }
            return App.BigStore.get(CACHE_PREFIX + k).then(function (v) {
                return v || null;
            }, function () { return null; });
        },

        /** @returns {Promise<boolean>} */
        has: function (item, lang) {
            var k = SC.keyFor(item, lang);
            if (!k) { return Promise.resolve(false); }
            var idx = idxLoad();
            return Promise.resolve(!!idx[k]);
        },

        /** @returns {Promise<boolean>} yazilabildi mi */
        put: function (item, lang, data) {
            var k = SC.keyFor(item, lang);
            if (!k || !data || !data.text) { return Promise.resolve(false); }

            var rec = {
                text: data.text,
                name: data.name || '',
                language: data.language || lang || '',
                at: Date.now()
            };

            return App.BigStore.set(CACHE_PREFIX + k, rec).then(function () {
                var idx = idxLoad();
                idx[k] = {
                    name: rec.name,
                    at: rec.at,
                    size: rec.text.length,
                    title: (item.seriesName || item.name || ''),
                    season: item.season || 0,
                    episode: item.episodeNum || 0
                };
                idxSave(idx);
                log.info('altyazi onbellege alindi:', k, Math.round(rec.text.length / 1024) + ' KB');
                return true;
            }, function (e) {
                log.warn('altyazi onbellege yazilamadi:', e && e.detail);
                return false;
            });
        },

        remove: function (item, lang) {
            var k = SC.keyFor(item, lang);
            if (!k) { return Promise.resolve(false); }
            var idx = idxLoad();
            delete idx[k];
            idxSave(idx);
            return App.BigStore.remove(CACHE_PREFIX + k);
        },

        /** Onbellek istatistigi: kac altyazi, toplam kac KB */
        stats: function () {
            var idx = idxLoad();
            var n = 0, bytes = 0;
            for (var k in idx) {
                if (Object.prototype.hasOwnProperty.call(idx, k)) {
                    n++; bytes += (idx[k].size || 0);
                }
            }
            return { count: n, kb: Math.round(bytes / 1024) };
        },

        clear: function () {
            var idx = idxLoad();
            var jobs = [];
            for (var k in idx) {
                if (Object.prototype.hasOwnProperty.call(idx, k)) {
                    jobs.push(App.BigStore.remove(CACHE_PREFIX + k));
                }
            }
            App.Storage.remove(IDX_KEY);
            return Promise.all(jobs).then(function () { return true; }, function () { return false; });
        }
    };

    App.SubtitleCache = SC;

    App.Subtitles = S;
})(window.App = window.App || {});
