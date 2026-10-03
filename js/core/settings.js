/* ============================================================
   js/core/settings.js
   Uygulama tercihleri. Ayarlar ekranindan degistirilir,
   localStorage'da saklanir, uygulama acilisinda okunur.
   ============================================================ */
(function (App) {
    'use strict';

    var K = 'settings';

    var DEFAULTS = {
        /* --- Oynatici --- */
        displayMode: 'PLAYER_DISPLAY_MODE_LETTER_BOX',
        /*   LETTER_BOX        : en-boy orani korunur (varsayilan, dogru goruntu)
             FULL_SCREEN       : ekrani doldurur, goruntu gerilebilir
             AUTO_ASPECT_RATIO : TV karar verir */

        preferredFormat: 'm3u8',   /* canli yayin icin ilk denenecek format: m3u8 | ts */
        vodPlayer: 'auto',         /* MKV film/dizi oynaticisi: auto (AVPlay; yalnizca
                                      saramadigi dosyalarda MSE) | mse (tum MKV'ler MSE) */
        mode4K: true,              /* AVPlay SET_MODE_4K (2020+ modeller) */
        userAgent: '',             /* bazi paneller ozel UA ister; bos = varsayilan */
        osdTimeout: 6,             /* oynaticida bilgi seridi kac saniye sonra kaybolsun */
        autoResume: true,          /* film/bolumde kaldigi yerden devam */

        /* --- Dizi izleme (Netflix tarzi) --- */
        autoNextEpisode: true,     /* bolum bitince sonrakine otomatik gec */
        nextEpisodeCountdown: 10,  /* son N saniyede "sonraki bolum" geri sayimi */
        introSkipSeconds: 90,      /* "Intro'yu atla" kac saniyeye atlasin */
        showIntroSkip: true,       /* intro atlama onerisi gosterilsin mi */
        seekStep: 10,              /* ok tusuyla temel ileri/geri adimi (sn) */

        /* Secilen ses/altyazi DILI hatirlanir (indeks degil - indeks her
           dosyada degisir). '' = tercih yok, 'off' = altyazi kapali. */
        preferredAudioLang: '',
        preferredSubtitleLang: '',
        subtitleSearchLang: 'tr',  /* OpenSubtitles aramasinda tercih edilen dil */
        autoLoadCachedSubtitle: true,  /* daha once indirilmis altyaziyi otomatik yukle */

        /* --- Arayuz --- */
        splashSeconds: 10,         /* acilis gorseli kac saniye kalsin (0 = kapali) */
        showChannelNumbers: true,
        startupView: 'home',       /* home | live  (acilista hangi ekran) */
        resumeLastChannel: false,  /* acilista son kanali otomatik ac */

        /* --- EPG --- */
        epgSource: 'auto',         /* auto (Xtream short_epg) | xmltv | off */
        epgAutoLoad: false,        /* acilista XMLTV indirilsin mi (buyuk dosya!) */

        /* --- Tani --- */
        logLevel: 'info'           /* debug | info | warn | error | none */
    };

    var values = null;

    function load() {
        if (values) { return values; }
        var stored = App.Storage.get(K, {}) || {};
        values = Object.assign({}, DEFAULTS, stored);
        return values;
    }

    var S = {
        DEFAULTS: DEFAULTS,

        get: function (key) {
            load();
            return (key === undefined) ? Object.assign({}, values) : values[key];
        },

        set: function (key, value) {
            load();
            values[key] = value;
            App.Storage.trySet(K, values);
            App.Bus.emit('settings:change', { key: key, value: value });
            if (key === 'logLevel') { App.Logger.setLevel(value); }
            return value;
        },

        /** Bir ayari sirayla sonraki degere cevirir (Ayarlar ekraninda OK basinca) */
        cycle: function (key, options) {
            var cur = S.get(key);
            var i = 0;
            for (var j = 0; j < options.length; j++) {
                if (options[j].value === cur) { i = j; break; }
            }
            var next = options[(i + 1) % options.length];
            S.set(key, next.value);
            return next;
        },

        toggle: function (key) {
            var v = !S.get(key);
            S.set(key, v);
            return v;
        },

        reset: function () {
            values = Object.assign({}, DEFAULTS);
            App.Storage.trySet(K, values);
            App.Logger.setLevel(values.logLevel);
            App.Bus.emit('settings:change', { key: '*', value: values });
        },

        /** Acilista uygulanacak ayarlar */
        apply: function () {
            load();
            App.Logger.setLevel(values.logLevel);
        }
    };

    App.Settings = S;
})(window.App = window.App || {});
