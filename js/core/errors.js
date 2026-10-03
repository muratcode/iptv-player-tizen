/* ============================================================
   js/core/errors.js
   Tum hata durumlari icin TEK bir tip: App.AppError.
   Her hatanin bir 'code' degeri ve kullaniciya gosterilecek
   Turkce mesaji vardir. Boylece hicbir yerde ham JS hatasi
   ekrana dusmez, uygulama cokmez.
   ============================================================ */
(function (App) {
    'use strict';

    var CODES = {
        NETWORK:        'NETWORK',        /* Baglanti kurulamadi / DNS / CORS */
        TIMEOUT:        'TIMEOUT',        /* Istek zaman asimina ugradi */
        HTTP:           'HTTP',           /* 4xx / 5xx */
        PARSE:          'PARSE',          /* JSON / M3U / XML cozumlenemedi */
        AUTH:           'AUTH',           /* Kullanici adi veya sifre hatali */
        EXPIRED:        'EXPIRED',        /* Hesap suresi dolmus / banli */
        EMPTY:          'EMPTY',          /* Liste bos dondu */
        NOT_FOUND:      'NOT_FOUND',
        PLAYER:         'PLAYER',         /* AVPlay hatasi */
        UNSUPPORTED:    'UNSUPPORTED',    /* Bu kaynak turu bu ozelligi desteklemiyor */
        OFFLINE:        'OFFLINE',        /* TV internete bagli degil */
        STORAGE:        'STORAGE',        /* localStorage kotasi doldu */
        ABORTED:        'ABORTED',
        UNKNOWN:        'UNKNOWN'
    };

    var MESSAGES = {
        NETWORK:     'Sunucuya baglanilamadi.\nInternet baglantinizi ve sunucu adresini kontrol edin.',
        TIMEOUT:     'Sunucu zamaninda yanit vermedi.\nBaglanti yavas olabilir, lutfen tekrar deneyin.',
        HTTP:        'Sunucu beklenmeyen bir yanit dondurdu.',
        PARSE:       'Sunucudan gelen veri okunamadi.\nAdresin dogru bir IPTV sunucusu oldugundan emin olun.',
        AUTH:        'Kullanici adi veya sifre hatali.\nBilgilerinizi kontrol edip tekrar deneyin.',
        EXPIRED:     'Hesabinizin suresi dolmus veya hesap devre disi birakilmis.\nLutfen servis saglayiciniz ile iletisime gecin.',
        EMPTY:       'Gosterilecek icerik bulunamadi.',
        NOT_FOUND:   'Istenen icerik bulunamadi.',
        PLAYER:      'Yayin baslatilamadi.\nKanal gecici olarak yayinda olmayabilir.',
        UNSUPPORTED: 'Bu ozellik secili kaynak turu icin desteklenmiyor.',
        OFFLINE:     'Televizyon internete bagli degil.\nAg ayarlarini kontrol edin.',
        STORAGE:     'Cihaz depolama alani dolu.\nAyarlar bolumunden onbellegi temizleyebilirsiniz.',
        ABORTED:     'Islem iptal edildi.',
        UNKNOWN:     'Beklenmeyen bir hata olustu.'
    };

    /**
     * @param {string} code   CODES icinden bir deger
     * @param {string} [detail] Teknik detay (log icin, kullaniciya kucuk puntoda)
     * @param {object} [extra]  ek alanlar (status, url ...)
     */
    function AppError(code, detail, extra) {
        this.name = 'AppError';
        this.code = CODES[code] ? code : CODES.UNKNOWN;
        this.message = MESSAGES[this.code] || MESSAGES.UNKNOWN;
        this.detail = detail || '';
        if (extra) {
            for (var k in extra) {
                if (Object.prototype.hasOwnProperty.call(extra, k)) { this[k] = extra[k]; }
            }
        }
        this.stack = (new Error(this.code + ': ' + this.detail)).stack;
    }
    AppError.prototype = Object.create(Error.prototype);
    AppError.prototype.constructor = AppError;

    AppError.prototype.toString = function () {
        return this.code + (this.detail ? ' (' + this.detail + ')' : '');
    };

    /** Herhangi bir seyi AppError'a cevirir - catch bloklarinda kullanilir */
    AppError.wrap = function (e, fallbackCode) {
        if (e instanceof AppError) { return e; }
        if (e && e.code && MESSAGES[e.code]) { return new AppError(e.code, e.detail || e.message); }
        return new AppError(fallbackCode || CODES.UNKNOWN, (e && (e.message || e.name)) || String(e));
    };

    AppError.CODES = CODES;
    AppError.MESSAGES = MESSAGES;

    App.AppError = AppError;
    App.ERR = CODES;
})(window.App = window.App || {});
