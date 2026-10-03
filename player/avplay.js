/* ============================================================
   player/avplay.js
   Samsung AVPlay sarmalayicisi.

   KULLANILAN TIZEN / SAMSUNG API'LERI
   -----------------------------------
   webapis.avplay.open(url)
        Kaynagi acar. HLS(.m3u8), MPEG-TS(.ts), MP4, MKV, DASH...
   webapis.avplay.setDisplayRect(x, y, w, h)
        Donanim video duzleminin sayfadaki konumu. open()'dan SONRA,
        prepareAsync()'ten ONCE cagrilmalidir.
   webapis.avplay.setDisplayMethod(mode)
        LETTER_BOX (en-boy korunur) / FULL_SCREEN (gerilir) /
        AUTO_ASPECT_RATIO. Kullanici Ayarlar'dan degistirebilir.
   webapis.avplay.setStreamingProperty(key, value)
        'SET_MODE_4K'     : 4K yayinlar icin donanim yolunu acar (2020+ TV)
        'ADAPTIVE_INFO'   : HLS baslangic bit hizi / bant genisligi ipuclari
        'COOKIE'          : Bazi panellerin istedigi oturum cerezleri
        'USER_AGENT'      : Bazi paneller belirli UA disinda 403 doner
   webapis.avplay.setBufferingParam(option, unit, size)
        Baslangic / yeniden tamponlama miktari. Samsung: deger EN AZ
        4 SANIYE olmalidir; daha kucugu gecersizdir.
   webapis.avplay.setTimeoutForBuffering(saniye)
        Bu sure dolunca tampon dolmamis olsa bile oynatma devam eder
        (onbufferingcomplete tetiklenir). Samsung 3-10 sn oneriyor.
   webapis.avplay.prepareAsync(ok, err)
        Cozucuyu hazirlar. SENKRON prepare() UI'yi kilitler - KULLANMAYIN.
   webapis.avplay.seekTo(ms, ok, err)
        ASENKRONDUR. Samsung dokumani: "Bu islem surerken baska API
        cagrisina izin verilmez; uygulama callback'lerden birini
        beklemelidir." Ust uste sarma, sarma sirasinda duraklatma veya
        parca listesi okuma GORUNTUYU DONDURUR. Bu yuzden asagida bir
        "mesgul" kilidi vardir: sarma surerken gelen istekler siraya
        alinir, sarma bitince uygulanir.
   webapis.avplay.getTotalTrackInfo() / setSelectTrack(type, index)
        Coklu ses / altyazi parcasi secimi (Tizen 4.0+ guvenilir).
   webapis.avplay.getState()
        'NONE' | 'IDLE' | 'READY' | 'PLAYING' | 'PAUSED'

   TIZEN SURUM NOTLARI
   -------------------
   - setStreamingProperty('SET_MODE_4K') 2018 oncesi modellerde yoktur ->
     try/catch icinde cagriliyor.
   - getTotalTrackInfo() Tizen 2.4'te bazen bos dizi doner -> guvenli.
   - Bu proje Tizen 9.0 (2025) hedeflenerek yazildi ancak tum cagrilar
     ozellik-algilama (feature detection) ile korunmustur; eski
     firmware'lerde ilgili ozellik sessizce devre disi kalir.
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('AVPlay');

    /* AVPlay hata kodlarinin Turkce karsiliklari */
    var ERROR_TEXT = {
        PLAYER_ERROR_NONE: 'Bilinmeyen oynatici hatasi.',
        PLAYER_ERROR_INVALID_PARAMETER: 'Gecersiz yayin adresi.',
        PLAYER_ERROR_NO_SUCH_FILE: 'Yayin adresi bulunamadi (404).',
        PLAYER_ERROR_INVALID_OPERATION: 'Oynatici gecersiz bir islem yapti.',
        PLAYER_ERROR_SEEK_FAILED: 'Ileri/geri sarma basarisiz oldu.',
        PLAYER_ERROR_INVALID_STATE: 'Oynatici uygun durumda degil.',
        PLAYER_ERROR_NOT_SUPPORTED_FILE: 'Bu yayin formati TV tarafindan desteklenmiyor.',
        PLAYER_ERROR_INVALID_URI: 'Yayin adresi hatali.',
        PLAYER_ERROR_CONNECTION_FAILED: 'Yayin sunucusuna baglanilamadi.',
        PLAYER_ERROR_GENERIC: 'Yayin acilamadi.',
        PLAYER_ERROR_NETWORK: 'Ag hatasi nedeniyle yayin kesildi.',
        PLAYER_ERROR_RESOURCE_LIMIT: 'TV kaynaklari yetersiz. Diger uygulamalari kapatin.',
        PLAYER_ERROR_PERMISSION_DENIED: 'Yayina erisim reddedildi (hesap sinirlari?).',
        PLAYER_ERROR_BUFFER_SPACE: 'Tampon alani yetersiz.'
    };

    function av() { return window.webapis && window.webapis.avplay; }

    /* Ekranin tamamini kaplayan dikdortgen (uygulama koordinat sistemi) */
    function fullRect() {
        var d = document.documentElement;
        return {
            x: 0, y: 0,
            w: d.clientWidth || window.innerWidth || 1920,
            h: d.clientHeight || window.innerHeight || 1080
        };
    }

    /* Sarma callback'i bu sure icinde gelmezse oynatici TAKILMIS sayilir
       (bazi firmware'ler / dosyalar gecersiz konumda callback'i hic
       cagirmiyor). Kilit acilir ama bekleyen komutlar GONDERILMEZ;
       controller yayini bastan acar (bkz. lastSeekFail). */
    var SEEK_GUARD_MS = 12000;
    /* Yeni yayin acilirken / durdurulurken suren sarmanin bitmesi icin
       en fazla bu kadar beklenir. */
    var IDLE_WAIT_MS = 2500;

    function AvPlayer() {
        this.name = 'avplay';
        this.el = document.getElementById('av-player');
        this.handlers = {};
        this.currentUrl = '';
        this.isLive = false;
        this.prepared = false;

        /* --- Asenkron islem kilidi (bkz. dosya basi: seekTo) --- */
        this._busy = false;         /* seekTo callback'i bekleniyor */
        this._seekQ = null;         /* {ms, waiters[]} siradaki EN SON hedef */
        this._deferred = [];        /* [{key, fn}] sarma bitince calisacaklar */
        this._idleWaiters = [];
        this._session = 0;          /* her yeni yayin / durdurmada artar */
        /* Son basarisiz sarmanin nedeni: 'error' (AVPlay hata dondu) veya
           'timeout' (hic yanit vermedi -> oynatici takili) */
        this.lastSeekFail = '';

        /* Kilit surerken API'ye soramadigimiz degerler */
        this._timeCache = 0;
        this._durCache = 0;
        this._tracksCache = null;
    }

    AvPlayer.isAvailable = function () { return !!av(); };

    AvPlayer.prototype.setHandlers = function (h) { this.handlers = h || {}; };

    AvPlayer.prototype._fire = function (name) {
        var fn = this.handlers[name];
        if (typeof fn !== 'function') { return; }
        var args = Array.prototype.slice.call(arguments, 1);
        try { fn.apply(null, args); }
        catch (e) { log.error('handler ' + name, e && e.message); }
    };

    /* ---------------- Kilit yardimcilari ---------------- */

    /** Sarma suruyor mu? (controller dil tercihini uygularken bakar) */
    AvPlayer.prototype.isBusy = function () { return this._busy; };

    /**
     * Islemi hemen calistir; sarma suruyorsa bitince calistir.
     * Ayni anahtarla bekleyen eski istek EZILIR (ornek: sarma sirasinda
     * iki kez duraklat/devam basilirsa yalnizca sonuncusu uygulanir).
     */
    AvPlayer.prototype._run = function (key, fn) {
        if (!this._busy) { fn(); return; }
        for (var i = this._deferred.length - 1; i >= 0; i--) {
            if (this._deferred[i].key === key) { this._deferred.splice(i, 1); }
        }
        this._deferred.push({ key: key, fn: fn });
    };

    AvPlayer.prototype._flushDeferred = function () {
        var list = this._deferred;
        this._deferred = [];
        for (var i = 0; i < list.length; i++) {
            try { list[i].fn(); } catch (e) { log.warn('ertelenen islem', list[i].key, e && e.message); }
        }
    };

    AvPlayer.prototype._notifyIdle = function () {
        var w = this._idleWaiters;
        this._idleWaiters = [];
        for (var i = 0; i < w.length; i++) { w[i](); }
    };

    /** Sarma bitene kadar (en fazla maxMs) bekle */
    AvPlayer.prototype._whenIdle = function (maxMs) {
        var self = this;
        if (!this._busy) { return Promise.resolve(); }
        return new Promise(function (resolve) {
            var done = false;
            function fin() {
                if (done) { return; }
                done = true;
                clearTimeout(t);
                resolve();
            }
            var t = setTimeout(function () {
                log.warn('sarma ' + maxMs + ' ms icinde bitmedi, beklemeden devam ediliyor');
                fin();
            }, maxMs);
            self._idleWaiters.push(fin);
        });
    };

    /** Siradaki sarma ve ertelenen islemleri iptal et (yayin degisiyor) */
    AvPlayer.prototype._dropQueued = function () {
        if (this._seekQ) {
            var w = this._seekQ.waiters;
            this._seekQ = null;
            for (var i = 0; i < w.length; i++) { w[i](false); }
        }
        this._deferred = [];
    };

    /**
     * Yayini hazirla ve oynatmaya hazir hale getir.
     * @param {string} url
     * @param {object} opts {isLive, displayMode, startTimeMs, userAgent, use4K}
     * @returns {Promise}
     */
    AvPlayer.prototype.prepare = function (url, opts) {
        var self = this;
        var token = ++this._session;
        this._dropQueued();

        /* Onceki yayinda sarma suruyorsa stop/open cagrilamaz: once bitsin */
        return this._whenIdle(IDLE_WAIT_MS).then(function () {
            if (token !== self._session) {
                /* Bu arada daha yeni bir yayin istendi; bu istek gecersiz */
                throw new App.AppError(App.ERR.PLAYER, 'yerine yenisi acildi');
            }
            return self._prepareNow(url, opts || {}, token);
        });
    };

    AvPlayer.prototype._prepareNow = function (url, opts, token) {
        var self = this;

        return new Promise(function (resolve, reject) {
            var a = av();
            if (!a) {
                return reject(new App.AppError(App.ERR.PLAYER, 'webapis.avplay yok'));
            }

            /* Onceki oturumu temizle - AVPlay tek instance'tir */
            try { self._hardStop(true); } catch (e) { log.warn('onceki oturum kapatilamadi', e && e.message); }
            self._timeCache = 0;
            self._durCache = 0;
            self._tracksCache = null;

            self.currentUrl = url;
            self.isLive = !!opts.isLive;
            self.prepared = false;

            /* 1) Kaynagi ac */
            try {
                a.open(url);
            } catch (e1) {
                return reject(new App.AppError(App.ERR.PLAYER, 'open: ' + (e1 && e1.message)));
            }

            /* 2) Video duzleminin konumu (tam ekran) */
            try {
                var r = fullRect();
                a.setDisplayRect(r.x, r.y, r.w, r.h);
            } catch (e2) { log.warn('setDisplayRect', e2 && e2.message); }

            /* 3) En-boy modu */
            try {
                a.setDisplayMethod(opts.displayMode || 'PLAYER_DISPLAY_MODE_LETTER_BOX');
            } catch (e3) { log.warn('setDisplayMethod', e3 && e3.message); }

            /* 4) Akis ozellikleri (open sonrasi, prepare oncesi olmali) */
            self._applyStreamingProps(opts);

            /* 5) Tampon parametreleri
                  Samsung: deger EN AZ 4 sn olmalidir. Onceden 2 sn veriliyordu;
                  gecersiz deger yuzunden ozellikle SARMA SONRASI yeniden
                  tamponlama (PLAYER_BUFFER_FOR_RESUME) bozuluyor, goruntu
                  takilip duruyordu.
                  RESUME = takilma veya sarmadan sonra oynatmanin yeniden
                  baslamasi icin gereken tampon. VOD'da biraz yuksek tutmak,
                  sarmadan hemen sonra tekrar takilmayi onler. */
            try {
                a.setBufferingParam('PLAYER_BUFFER_FOR_PLAY',
                                    'PLAYER_BUFFER_SIZE_IN_SECOND', 4);
            } catch (e4) { log.debug('setBufferingParam(PLAY) desteklenmiyor'); }
            try {
                a.setBufferingParam('PLAYER_BUFFER_FOR_RESUME',
                                    'PLAYER_BUFFER_SIZE_IN_SECOND', self.isLive ? 4 : 5);
            } catch (e4b) { log.debug('setBufferingParam(RESUME) desteklenmiyor'); }

            try {
                /* Tampon bu surede dolmazsa oynatma yine de devam eder
                   (hata VERMEZ). 20 sn, sarmadan sonra 20 sn donuk ekran
                   demekti; Samsung'un onerdigi araligin ust siniri. */
                a.setTimeoutForBuffering(10);
            } catch (e5) { log.debug('setTimeoutForBuffering desteklenmiyor'); }

            /* 6) Olay dinleyicileri */
            try {
                /* Eski oturumdan gec gelen olaylar yeni yayini bozmasin */
                var live = function () { return token === self._session; };
                a.setListener({
                    onbufferingstart: function () {
                        if (live()) { self._fire('onBufferingStart'); }
                    },
                    onbufferingprogress: function (percent) {
                        if (live()) { self._fire('onBuffering', percent); }
                    },
                    onbufferingcomplete: function () {
                        if (live()) { self._fire('onBufferingComplete'); }
                    },
                    oncurrentplaytime: function (ms) {
                        if (!live()) { return; }
                        self._timeCache = ms || 0;
                        self._fire('onTime', ms);
                    },
                    onstreamcompleted: function () {
                        if (!live()) { return; }
                        log.info('yayin tamamlandi');
                        self._fire('onComplete');
                    },
                    onevent: function (type, data) {
                        log.debug('avplay event:', type, data);
                        if (live()) { self._fire('onEvent', type, data); }
                    },
                    onerror: function (type) {
                        log.error('avplay error:', type);
                        if (live()) {
                            self._fire('onError', type, ERROR_TEXT[type] || ERROR_TEXT.PLAYER_ERROR_GENERIC);
                        }
                    },
                    /* AVPlay altyaziyi EKRANA CIZMEZ; yalnizca metni ve ne
                       kadar sure gosterilecegini (ms) bildirir. Cizim isi
                       views/player.js icindeki .subtitle katmanina aittir. */
                    onsubtitlechange: function (duration, text) {
                        if (live()) { self._fire('onSubtitle', text, duration); }
                    },
                    ondrmevent: function (type, data) {
                        log.debug('drm event', type, data);
                    }
                });
            } catch (e6) {
                return reject(new App.AppError(App.ERR.PLAYER, 'setListener: ' + (e6 && e6.message)));
            }

            /* 7) Asenkron hazirlik */
            var settled = false;
            var guard = setTimeout(function () {
                if (settled) { return; }
                settled = true;
                log.error('prepareAsync 30 sn icinde donmedi');
                reject(new App.AppError(App.ERR.TIMEOUT, 'prepareAsync timeout'));
            }, 30000);

            try {
                a.prepareAsync(function () {
                    if (settled) { return; }
                    settled = true;
                    clearTimeout(guard);
                    if (token !== self._session) {
                        reject(new App.AppError(App.ERR.PLAYER, 'yerine yenisi acildi'));
                        return;
                    }
                    self.prepared = true;
                    try { self._durCache = a.getDuration() || 0; } catch (eD) { }
                    log.info('hazir:', App.Utils.truncate(url, 90));
                    self._fire('onReady');
                    resolve();
                }, function (err) {
                    if (settled) { return; }
                    settled = true;
                    clearTimeout(guard);
                    var name = (err && (err.name || err.message)) || 'PLAYER_ERROR_GENERIC';
                    reject(new App.AppError(App.ERR.PLAYER, String(name)));
                });
            } catch (e7) {
                clearTimeout(guard);
                reject(new App.AppError(App.ERR.PLAYER, 'prepareAsync: ' + (e7 && e7.message)));
            }
        });
    };

    AvPlayer.prototype._applyStreamingProps = function (opts) {
        var a = av();
        if (!a) { return; }

        /* 4K modu: 2020+ modellerde UHD yayinlarin donanimla cozulmesini saglar.
           Desteklemeyen modellerde exception firlatir -> yutuluyor. */
        if (opts.use4K !== false) {
            try { a.setStreamingProperty('SET_MODE_4K', 'TRUE'); }
            catch (e) { log.debug('SET_MODE_4K desteklenmiyor'); }
        }

        /* HLS baslangic bit hizi: dusukten baslayip yukselmek kanal acilisini
           1-2 saniye hizlandirir. Bicim: |BITRATES=min~max|STARTBITRATE=LOWEST */
        if (opts.isLive) {
            try {
                a.setStreamingProperty('ADAPTIVE_INFO',
                    '|STARTBITRATE=LOWEST|SKIPBITRATE=LOWEST');
            } catch (e2) { log.debug('ADAPTIVE_INFO desteklenmiyor'); }
        }

        if (opts.userAgent) {
            try { a.setStreamingProperty('USER_AGENT', opts.userAgent); }
            catch (e3) { log.debug('USER_AGENT desteklenmiyor'); }
        }
        if (opts.cookie) {
            try { a.setStreamingProperty('COOKIE', opts.cookie); }
            catch (e4) { log.debug('COOKIE desteklenmiyor'); }
        }
    };

    AvPlayer.prototype.play = function () {
        var a = av();
        if (!a) { return false; }
        document.body.classList.add('player-active');
        this.el.classList.add('is-avplay');
        var ok = true;
        this._run('playstate', function () {
            try { a.play(); }
            catch (e) { ok = false; log.error('play', e && e.message); }
        });
        return ok;
    };

    AvPlayer.prototype.pause = function () {
        var a = av();
        if (!a || this.isLive) { return false; }
        var ok = true;
        this._run('playstate', function () {
            try { a.pause(); }
            catch (e) { ok = false; log.error('pause', e && e.message); }
        });
        return ok;
    };

    AvPlayer.prototype.resume = function () {
        var a = av();
        if (!a) { return false; }
        var ok = true;
        this._run('playstate', function () {
            try { a.play(); }
            catch (e) { ok = false; log.error('resume', e && e.message); }
        });
        return ok;
    };

    AvPlayer.prototype.stop = function () {
        var self = this;
        document.body.classList.remove('player-active');
        if (this.el) { this.el.classList.remove('is-avplay'); }

        if (!this._busy) { this._hardStop(); return; }

        /* Sarma suruyorken stop() da "baska API" sayilir ve bazi modellerde
           oynaticiyi kilitler. Goruntu katmani hemen gizlendi; gercek
           durdurma sarma callback'i gelince (en gec IDLE_WAIT_MS) yapilir.
           Bu arada yeni bir yayin acilirsa o kendi temizligini yapar. */
        var token = this._session;
        this._dropQueued();
        this._whenIdle(IDLE_WAIT_MS).then(function () {
            if (token === self._session) { self._hardStop(); }
        });
    };

    /** @param {boolean} [keepSession] prepare() icinden cagrildiginda true */
    AvPlayer.prototype._hardStop = function (keepSession) {
        if (!keepSession) { this._session++; }
        this._dropQueued();
        this._busy = false;
        this._notifyIdle();

        var a = av();
        if (!a) { return; }
        var st = 'NONE';
        try { st = a.getState(); } catch (e) { }
        if (st !== 'NONE') {
            try { a.stop(); } catch (e2) { log.debug('stop', e2 && e2.message); }
            try { a.close(); } catch (e3) { log.debug('close', e3 && e3.message); }
        }
        this.prepared = false;
    };

    /**
     * Mutlak konuma sar.
     *
     * SIRALI CALISIR: onceki sarmanin callback'i gelmeden AVPlay'e yeni
     * sarma gonderilmez. Bu arada gelen hedeflerden yalnizca SONUNCUSU
     * saklanir ve ilk sarma bitince uygulanir (ara hedefler atlanir).
     * Donen promise, istenen hedefe (veya onun yerini alan daha yeni
     * hedefe) ulasildiginda cozulur.
     *
     * @param {number} ms
     * @returns {Promise<boolean>}
     */
    AvPlayer.prototype.seekTo = function (ms) {
        var self = this;
        if (!av() || this.isLive || !this.prepared) { return Promise.resolve(false); }

        return new Promise(function (resolve) {
            if (!self._seekQ) { self._seekQ = { ms: 0, waiters: [] }; }
            self._seekQ.ms = Math.max(0, Math.floor(ms));
            self._seekQ.waiters.push(resolve);
            if (!self._busy) { self._pumpSeek(); }
        });
    };

    AvPlayer.prototype._pumpSeek = function () {
        var self = this;
        var a = av();
        var job = this._seekQ;
        this._seekQ = null;
        if (!job) { return; }

        var session = this._session;
        var settled = false;
        var guard = null;
        this._busy = true;
        this.lastSeekFail = '';

        /** @param {string} [fail] '' basarili, 'error' | 'timeout' */
        function done(fail) {
            if (settled) { return; }
            settled = true;
            clearTimeout(guard);

            var same = (session === self._session);
            var ok = same && !fail;
            if (ok) { self._timeCache = job.ms; }
            if (same && fail) { self.lastSeekFail = fail; }

            /* Takilan oynaticiya yeni sarma veya ertelenen komut gonderilmez
               (goruntuyu iyice kilitler); controller yayini yeniden acar. */
            if (fail === 'timeout') { self._dropQueued(); }

            for (var i = 0; i < job.waiters.length; i++) { job.waiters[i](ok); }

            /* Sarma surerken daha yeni bir hedef geldiyse kilidi birakmadan
               hemen ona gec (arada baska API cagrisi araya girmesin). */
            if (same && self._seekQ) { self._pumpSeek(); return; }

            self._busy = false;
            if (same) { self._flushDeferred(); } else { self._deferred = []; }
            self._notifyIdle();
        }

        guard = setTimeout(function () {
            log.warn('seekTo ' + SEEK_GUARD_MS + ' ms icinde yanit vermedi:', job.ms);
            done('timeout');
        }, SEEK_GUARD_MS);

        try {
            a.seekTo(job.ms,
                function () { done(''); },
                function (e) { log.warn('seekTo hata', job.ms, e && (e.name || e.message)); done('error'); });
        } catch (e) {
            log.warn('seekTo', e && e.message);
            done('error');
        }
    };

    /** @param {number} deltaMs +/- atlama (seekTo kuyrugunu kullanir) */
    AvPlayer.prototype.jump = function (deltaMs) {
        var base = this._seekQ ? this._seekQ.ms : this.getCurrentTime();
        return this.seekTo(base + deltaMs);
    };

    AvPlayer.prototype.getState = function () {
        var a = av();
        if (!a) { return 'NONE'; }
        if (this._busy) { return 'PLAYING'; }
        try { return a.getState(); } catch (e) { return 'NONE'; }
    };

    AvPlayer.prototype.getCurrentTime = function () {
        var a = av();
        if (!a || !this.prepared) { return 0; }
        if (this._busy) { return this._timeCache; }
        try { this._timeCache = a.getCurrentTime() || 0; } catch (e) { }
        return this._timeCache;
    };

    AvPlayer.prototype.getDuration = function () {
        var a = av();
        if (!a || !this.prepared) { return 0; }
        if (this._busy || this._durCache) { return this._durCache; }
        try { this._durCache = a.getDuration() || 0; } catch (e) { }
        return this._durCache;
    };

    AvPlayer.prototype.setDisplayMethod = function (mode) {
        var a = av();
        if (!a) { return; }
        this._run('display', function () {
            try { a.setDisplayMethod(mode); }
            catch (e) { log.warn('setDisplayMethod', e && e.message); }
        });
    };

    AvPlayer.prototype.setDisplayRect = function (x, y, w, h) {
        var a = av();
        if (!a) { return; }
        this._run('rect', function () {
            try { a.setDisplayRect(x, y, w, h); }
            catch (e) { log.warn('setDisplayRect', e && e.message); }
        });
    };

    AvPlayer.prototype.setFullscreen = function () {
        var r = fullRect();
        this.setDisplayRect(r.x, r.y, r.w, r.h);
    };

    /**
     * Ses / altyazi parcalari.
     * Sarma surerken AVPlay'e sorulamaz; son okunan liste doner.
     * @returns {Array<{index, type, language, label}>}
     */
    AvPlayer.prototype.getTracks = function () {
        var a = av();
        if (!a || !this.prepared) { return []; }
        if (this._busy) { return this._tracksCache ? this._tracksCache.slice() : []; }
        var raw;
        try { raw = a.getTotalTrackInfo(); } catch (e) { return []; }
        if (!raw || !raw.length) { return []; }

        var out = [];
        for (var i = 0; i < raw.length; i++) {
            var t = raw[i];
            var lang = '';
            var label = '';
            try {
                /* extra_info bazen JSON string, bazen nesnedir */
                var ex = t.extra_info;
                if (typeof ex === 'string') { ex = JSON.parse(ex); }
                if (ex) {
                    lang = ex.language || ex.track_lang || '';
                    label = ex.fourCC || ex.codec || '';
                }
            } catch (e2) { /* bicim taninmadi */ }

            out.push({
                index: t.index,
                type: t.type,                       /* 'AUDIO' | 'VIDEO' | 'TEXT' */
                language: String(lang).trim(),
                label: label
            });
        }
        this._tracksCache = out;
        return out.slice();
    };

    /**
     * @param {string} type 'AUDIO' | 'TEXT' | 'VIDEO'
     * @param {number} index getTracks()'ten gelen index
     */
    AvPlayer.prototype.selectTrack = function (type, index) {
        var a = av();
        if (!a || !this.prepared) { return false; }
        var ok = true;
        this._run('track.' + type, function () {
            try { a.setSelectTrack(type, index); }
            catch (e) { ok = false; log.warn('setSelectTrack', e && e.message); }
        });
        return ok;
    };

    AvPlayer.prototype.setSubtitleHidden = function (hidden) {
        var a = av();
        if (!a) { return; }
        this._run('subhidden', function () {
            try { a.setSilentSubtitle(!!hidden); } catch (e) { /* eski surum */ }
        });
    };

    /** Anlik bant genisligi (bps) - tani ekraninda gosterilir */
    AvPlayer.prototype.getBandwidth = function () {
        var a = av();
        if (!a || this._busy || !this.prepared) { return 0; }
        try { return parseInt(a.getStreamingProperty('CURRENT_BANDWIDTH'), 10) || 0; }
        catch (e) { return 0; }
    };

    AvPlayer.prototype.dispose = function () { this.stop(); };

    App.AvPlayer = AvPlayer;
    App.AvPlayErrors = ERROR_TEXT;
})(window.App = window.App || {});
