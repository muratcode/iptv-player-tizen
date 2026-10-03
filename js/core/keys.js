/* ============================================================
   js/core/keys.js
   Samsung TV kumanda tuslari.

   TIZEN API: tizen.tvinputdevice
   ------------------------------
   Yon tuslari, OK ve Return (Back) tuslari HER ZAMAN uygulamaya
   duser; kayit gerektirmez. Ancak MEDYA tuslari (Play/Pause/Stop,
   ileri/geri sarma), KANAL tuslari (Ch+/Ch-), RENKLI tuslar ve
   SAYI tuslari yalnizca registerKey() ile kaydedilirse uygulamaya
   iletilir; aksi halde TV'nin kendi yayin katmanina gider.

   registerKey() cagrisi config.xml'de
   http://tizen.org/privilege/tv.inputdevice privilege'ini gerektirir.

   Desteklenmeyen bir tus adi registerKey'e verilirse Tizen
   InvalidValuesError firlatir -> tek tek try/catch icinde kaydediyoruz
   ki eski/yeni firmware farklari uygulamayi kirmasin.
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('Keys');

    /* Samsung TV keyCode haritasi (Tizen TV Web API dokumantasyonu) */
    var KEY = {
        LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40,
        ENTER: 13,
        BACK: 10009,          /* Return tusu */
        EXIT: 10182,          /* Exit tusu */

        /* Medya tuslari */
        PLAY: 415,
        PAUSE: 19,
        PLAY_PAUSE: 10252,
        STOP: 413,
        REWIND: 412,
        FF: 417,
        RECORD: 416,

        /* Kanal */
        CH_UP: 427,
        CH_DOWN: 428,
        CH_LIST: 10073,

        /* Renkli tuslar */
        RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,

        /* Bilgi / menu */
        INFO: 457,
        MENU: 10133,
        TOOLS: 10135,
        SEARCH: 10225,

        /* Ses */
        VOL_UP: 447, VOL_DOWN: 448, MUTE: 449,

        /* Sayi tuslari (klavye ile ayni) */
        N0: 48, N1: 49, N2: 50, N3: 51, N4: 52,
        N5: 53, N6: 54, N7: 55, N8: 56, N9: 57
    };

    /* registerKey() ile kaydedilecek tus ADLARI (Tizen'in bekledigi string'ler) */
    var REGISTER_LIST = [
        'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
        'MediaRewind', 'MediaFastForward',
        'ChannelUp', 'ChannelDown', 'ChannelList',
        'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
        'Info', 'Exit',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
    ];

    var registered = [];
    var failed = [];

    function isNumberKey(code) { return code >= KEY.N0 && code <= KEY.N9; }
    function numberOf(code) { return isNumberKey(code) ? (code - KEY.N0) : -1; }

    var K = {
        KEY: KEY,
        isNumberKey: isNumberKey,
        numberOf: numberOf,

        /**
         * Uygulama acilirken bir kez cagrilir.
         * TV disinda (PC tarayici) sessizce hicbir sey yapmaz.
         */
        register: function () {
            if (!window.tizen || !tizen.tvinputdevice) {
                log.info('tizen.tvinputdevice yok (PC tarayici modu) - tus kaydi atlandi');
                return { registered: [], failed: [], available: false };
            }

            /* Once cihazin destekledigi tuslari ogren (firmware farklari icin) */
            var supported = null;
            try {
                var list = tizen.tvinputdevice.getSupportedKeys();
                supported = {};
                for (var i = 0; i < list.length; i++) { supported[list[i].name] = true; }
            } catch (e) {
                log.warn('getSupportedKeys basarisiz:', e && e.message);
            }

            for (var j = 0; j < REGISTER_LIST.length; j++) {
                var name = REGISTER_LIST[j];
                if (supported && !supported[name]) {
                    failed.push(name + ' (desteklenmiyor)');
                    continue;
                }
                try {
                    tizen.tvinputdevice.registerKey(name);
                    registered.push(name);
                } catch (e2) {
                    failed.push(name + ' (' + (e2 && e2.name) + ')');
                }
            }

            log.info('kaydedilen tus sayisi:', registered.length, '| basarisiz:', failed.length);
            if (failed.length) { log.debug('basarisiz tuslar:', failed.join(', ')); }
            return { registered: registered, failed: failed, available: true };
        },

        /** Uygulama kapanirken kaydi birak (TV kaynagini serbest birakir) */
        unregister: function () {
            if (!window.tizen || !tizen.tvinputdevice) { return; }
            for (var i = 0; i < registered.length; i++) {
                try { tizen.tvinputdevice.unregisterKey(registered[i]); } catch (e) { /* yoksay */ }
            }
            registered = [];
        },

        /** Hata ayiklama / Ayarlar ekraninda gostermek icin */
        nameOf: function (code) {
            for (var k in KEY) {
                if (Object.prototype.hasOwnProperty.call(KEY, k) && KEY[k] === code) { return k; }
            }
            return 'KEY_' + code;
        },

        status: function () { return { registered: registered.slice(), failed: failed.slice() }; }
    };

    App.Keys = K;
})(window.App = window.App || {});
