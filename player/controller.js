/* ============================================================
   player/controller.js
   Oynatma oturumu yoneticisi.

   SORUMLULUKLARI
   - Dogru motoru secmek (AVPlay varsa AVPlay, yoksa HTML5)
   - Yayin acilmazsa KURTARMA denemeleri:
       1) Canli + Xtream ise formati degistir (.m3u8 <-> .ts)
       2) Kisa bir bekleme sonrasi tekrar dene (max RETRY_LIMIT)
       3) Hepsi basarisizsa kullaniciya Turkce hata + "Tekrar Dene"
   - Kanal degistirme (zapping) icin liste baglami tutmak
   - Film/bolumde izleme konumunu kaydetmek (kaldigi yerden devam)
   - Durum degisikliklerini App.Bus uzerinden yayinlamak:
       'player:state'  {state, item}
       'player:time'   {position, duration}
       'player:error'  {code, message, item}
       'player:item'   {item, index, total}
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('Player');
    var U = App.Utils;

    var STATE = {
        IDLE: 'idle',
        LOADING: 'loading',
        BUFFERING: 'buffering',
        PLAYING: 'playing',
        PAUSED: 'paused',
        ERROR: 'error'
    };

    var RETRY_LIMIT = 2;
    var RETRY_DELAY = 1500;
    var POSITION_SAVE_MS = 15000;

    var engine = null;
    var state = STATE.IDLE;
    var current = null;           /* {item, url, ext, isLive} */
    var context = { items: [], index: -1 };
    var attempt = 0;
    var triedAlt = false;
    var lastError = null;
    var position = 0;             /* ms */
    var duration = 0;             /* ms */
    var saveTimer = null;
    var startAtMs = 0;
    var seekPending = 0;
    /* Secili ses/altyazi parcasi. AVPlay hangi parcanin secili oldugunu
       geri SORMAYA izin vermez; bu yuzden secimi biz hatirlariz ve
       menude isaretleriz. Yeni yayin acilinca sifirlanir. */
    var selectedTrack = { AUDIO: null, TEXT: null };
    var subtitleHidden = true;
    var prefTimer = null;
    /* Kullanici bu yayinda parcayi ELLE sectiyse, 900 ms sonra calisan
       otomatik dil tercihi onun secimini EZMEMELIDIR. */
    var manualPick = { AUDIO: false, TEXT: false };

    /* Her startStream cagrisinda artar. Hizli kanal degistirmede ESKI
       yayinin gec gelen basari/hata sonucu yeni yayini bozmasin diye
       sonuclar bu numarayla dogrulanir. */
    var streamGen = 0;

    /* Sarma durumu.
       busy   : motorda bekleyen sarma sayisi
       target : gidilen konum (ms). Sarma surerken AVPlay eski konumu
                bildirmeye devam edebilir; ilerleme cubugu geri ziplamasin
                ve ardisik basislar dogru noktadan devam etsin diye
                konum olarak bu deger kullanilir.
       settleUntil : sarma bittikten hemen sonra gelebilecek eski
                konum bildirimlerini yok saymak icin kisa pencere. */
    var seekState = { busy: 0, target: -1, settleUntil: 0, settleTarget: 0 };

    function setState(s) {
        if (state === s) { return; }
        state = s;
        App.Bus.emit('player:state', { state: s, item: current ? current.item : null });
    }

    function chooseEngine() {
        if (engine) { return engine; }
        if (App.AvPlayer.isAvailable()) {
            engine = new App.AvPlayer();
            log.info('motor: AVPlay (Samsung donanim oynaticisi)');
        } else {
            engine = new App.Html5Player();
            log.warn('motor: HTML5 <video> (webapis.avplay bulunamadi - PC tarayici modu)');
        }
        engine.setHandlers(handlers);
        return engine;
    }

    var handlers = {
        onReady: function () {
            duration = engine.getDuration();
        },
        onBufferingStart: function () {
            if (state === STATE.PLAYING || state === STATE.LOADING) { setState(STATE.BUFFERING); }
        },
        onBuffering: function (percent) {
            App.Bus.emit('player:buffering', { percent: percent });
        },
        onBufferingComplete: function () {
            if (state === STATE.BUFFERING || state === STATE.LOADING) { setState(STATE.PLAYING); }
        },
        onTime: function (ms) {
            /* Sarma surerken gelen konumlar ESKI konumdur - yok say */
            if (seekState.busy) { return; }
            if (Date.now() < seekState.settleUntil &&
                Math.abs((ms || 0) - seekState.settleTarget) > 10000) { return; }

            position = ms || 0;
            if (!duration) { duration = engine.getDuration(); }
            if (state === STATE.BUFFERING) { setState(STATE.PLAYING); }
            App.Bus.emit('player:time', { position: position, duration: duration });
        },
        onComplete: function () {
            log.info('icerik bitti');
            /* Otomatik sonraki bolum kararini views/player.js verir
               (geri sayim gosterip kullaniciya iptal sansi tanir). */
            App.Bus.emit('player:complete', {
                item: current ? current.item : null,
                hasNext: hasNext()
            });
            setState(STATE.IDLE);
        },
        onError: function (code, message) {
            lastError = { code: code, message: message };
            recover(new App.AppError(App.ERR.PLAYER, code));
        },
        onSubtitle: function (text, duration) {
            if (subtitleHidden) { return; }          /* kapaliyken cizme */
            App.Bus.emit('player:subtitle', {
                text: text || '',
                duration: U.toInt(duration, 0)
            });
        }
    };

    /**
     * KAYITLI DIL TERCIHINI UYGULA
     *
     * Parca INDEKSLERI her dosyada farklidir (bir bolumde Turkce ses 0,
     * digerinde 2 olabilir). Bu yuzden indeks degil DIL KODU hatirlanir ve
     * her yeni yayinda eslesen parca bulunup secilir.
     *
     * getTotalTrackInfo() ancak prepare tamamlandiktan sonra dolu doner;
     * bu yuzden oynatma basladiktan kisa bir sure sonra calistirilir.
     */
    function applyTrackPreferences() {
        var eng = chooseEngine();
        var tracks;

        /* Kaldigi yerden devam sarmasi suruyorsa AVPlay'e parca listesi
           SORULAMAZ (goruntu donar). Sarma bitince tekrar dene. */
        if (eng.isBusy && eng.isBusy()) {
            schedulePrefs(500);
            return;
        }
        try { tracks = eng.getTracks(); } catch (e) { return; }
        if (!tracks || !tracks.length) { return; }

        function findByLang(type, lang) {
            var want = String(lang || '').toLowerCase();
            if (!want) { return null; }
            for (var i = 0; i < tracks.length; i++) {
                var t = tracks[i];
                if (t.type !== type) { continue; }
                if (String(t.language || '').toLowerCase() === want) { return t; }
            }
            return null;
        }

        /* --- Ses --- */
        var wantAudio = manualPick.AUDIO ? '' : App.Settings.get('preferredAudioLang');
        if (wantAudio) {
            var at = findByLang('AUDIO', wantAudio);
            if (at && at.index !== selectedTrack.AUDIO) {
                if (eng.selectTrack('AUDIO', at.index)) {
                    selectedTrack.AUDIO = at.index;
                    log.info('kayitli ses dili uygulandi:', wantAudio);
                }
            }
        }

        /* --- Altyazi --- */
        if (manualPick.TEXT) { App.Bus.emit('player:tracks', { tracks: tracks }); return; }
        var wantSub = App.Settings.get('preferredSubtitleLang');
        if (wantSub === 'off' || !wantSub) {
            subtitleHidden = true;
            eng.setSubtitleHidden(true);
        } else {
            var st = findByLang('TEXT', wantSub);
            if (st) {
                subtitleHidden = false;
                eng.setSubtitleHidden(false);
                if (eng.selectTrack('TEXT', st.index)) {
                    selectedTrack.TEXT = st.index;
                    log.info('kayitli altyazi dili uygulandi:', wantSub);
                }
            } else {
                /* Bu icerikte o dil yok -> altyaziyi kapali tut */
                subtitleHidden = true;
                eng.setSubtitleHidden(true);
            }
        }

        App.Bus.emit('player:tracks', { tracks: tracks });
    }

    function schedulePrefs(ms) {
        if (prefTimer) { clearTimeout(prefTimer); }
        var gen = streamGen;
        prefTimer = setTimeout(function () {
            prefTimer = null;
            if (gen !== streamGen || !current) { return; }
            try { applyTrackPreferences(); }
            catch (e) { log.warn('dil tercihi uygulanamadi', e && e.message); }
        }, ms);
    }

    /**
     * Tum sarmalar buradan gecer: konumu hemen hedefe ceker (arayuz
     * gecikmesiz tepki versin), motor sarmayi sirayla uygular.
     */
    function engineSeek(ms) {
        if (!current || current.isLive) { return Promise.resolve(false); }
        var eng = chooseEngine();
        var max = duration > 0 ? Math.max(0, duration - 3000) : Math.max(0, ms);
        var target = U.clamp(Math.floor(ms), 0, max);

        var gen = streamGen;
        seekState.busy++;
        seekState.target = target;
        position = target;
        App.Bus.emit('player:time', { position: position, duration: duration, seeking: true });

        return eng.seekTo(target).then(function (ok) {
            if (gen !== streamGen) { return false; }   /* yayin degismis */
            seekState.busy = Math.max(0, seekState.busy - 1);
            if (!seekState.busy) {
                seekState.target = -1;
                seekState.settleUntil = Date.now() + 1500;
                seekState.settleTarget = position;
            }
            if (!ok) { log.warn('sarma basarisiz:', target); }
            return ok;
        });
    }

    function hasNext() {
        return context.items.length > 0 && context.index >= 0 && context.index < context.items.length - 1;
    }

    /** Konum kaydediciyi baslat (yalnizca VOD icin) */
    function startPositionSaver() {
        stopPositionSaver();
        if (!current || current.isLive) { return; }
        saveTimer = setInterval(function () {
            if (!current || state !== STATE.PLAYING) { return; }
            App.History.updatePosition(current.item.key,
                Math.floor(position / 1000), Math.floor(duration / 1000));
        }, POSITION_SAVE_MS);
    }

    function stopPositionSaver() {
        if (saveTimer) { clearInterval(saveTimer); saveTimer = null; }
    }

    /**
     * Hata sonrasi kurtarma stratejisi.
     */
    function recover(err) {
        if (!current) { setState(STATE.ERROR); return; }

        var item = current.item;
        var gen = streamGen;
        log.warn('kurtarma denemesi', 'attempt=' + attempt, 'triedAlt=' + triedAlt, err.detail);

        /* 1) Canli yayin + Xtream: alternatif format dene (.m3u8 <-> .ts) */
        if (!triedAlt && current.isLive) {
            var alt = App.Content.altStreamUrl(item, current.url);
            if (alt && alt !== current.url) {
                triedAlt = true;
                log.info('alternatif format deneniyor');
                App.Bus.emit('player:recovering', { reason: 'format' });
                setTimeout(function () {
                    /* Kullanici bu arada kanal degistirdiyse eskisini acma */
                    if (gen === streamGen && current) { startStream(item, alt, true); }
                }, 400);
                return;
            }
        }

        /* 2) Sinirli sayida yeniden deneme.
              Film/bolumde ag kopmasi sonrasi BASTAN degil, kalinan
              yerden devam edilir. */
        if (attempt < RETRY_LIMIT) {
            attempt++;
            if (!current.isLive && position > 5000) { seekPending = position; }
            log.info('yeniden deneme', attempt + '/' + RETRY_LIMIT);
            App.Bus.emit('player:recovering', { reason: 'retry', attempt: attempt });
            setTimeout(function () {
                if (gen === streamGen && current) { startStream(current.item, current.url, true); }
            }, RETRY_DELAY);
            return;
        }

        /* 3) Pes et */
        setState(STATE.ERROR);
        var msg = (lastError && lastError.message) || err.message;
        App.Bus.emit('player:error', {
            code: err.code,
            message: msg,
            detail: err.detail || (lastError && lastError.code) || '',
            item: item
        });
    }

    /** Dusuk seviyeli baslatma */
    function startStream(item, url, isRetry) {
        var eng = chooseEngine();
        var isLive = (item.type === 'live');
        var gen = ++streamGen;

        current = { item: item, url: url, isLive: isLive };
        if (!isRetry) { attempt = 0; triedAlt = false; lastError = null; }

        position = 0;
        duration = 0;
        seekState = { busy: 0, target: -1, settleUntil: 0, settleTarget: 0 };
        if (!isRetry) {
            selectedTrack = { AUDIO: null, TEXT: null };
            subtitleHidden = true;
            manualPick = { AUDIO: false, TEXT: false };
        }
        setState(STATE.LOADING);

        var opts = {
            isLive: isLive,
            displayMode: App.Settings.get('displayMode'),
            use4K: App.Settings.get('mode4K') !== false,
            userAgent: App.Settings.get('userAgent') || ''
        };

        log.info('baslatiliyor:', item.name, '|', U.truncate(url, 100));

        return eng.prepare(url, opts).then(function () {
            /* Bu arada baska bir yayin istendiyse bu sonuc gecersizdir */
            if (gen !== streamGen) { return false; }

            duration = eng.getDuration();
            eng.play();
            setState(STATE.PLAYING);

            /* Kaldigi yerden devam */
            if (!isLive && seekPending > 0) {
                var target = seekPending;
                seekPending = 0;
                position = target;
                setTimeout(function () {
                    if (gen === streamGen) { engineSeek(target); }
                }, 600);
            }

            startPositionSaver();

            /* Parca listesi ancak hazirlik bitince dolar; kisa bir gecikmeyle
               kayitli ses/altyazi dilini uygula. */
            schedulePrefs(900);

            App.Bus.emit('player:item', {
                item: item,
                index: context.index,
                total: context.items.length
            });
            return true;
        }, function (err) {
            if (gen !== streamGen) { return false; }
            recover(App.AppError.wrap(err, App.ERR.PLAYER));
            return false;
        });
    }

    var P = {
        STATE: STATE,

        init: function () {
            chooseEngine();
            return P;
        },

        engineName: function () { return chooseEngine().name; },

        /**
         * Icerik oynat.
         * @param {object} item  normalize edilmis icerik
         * @param {object} [opts] {context:{items,index}, resume:boolean, startMs:number}
         */
        play: function (item, opts) {
            opts = opts || {};
            if (!item) { return Promise.resolve(false); }

            if (opts.context) {
                context = {
                    items: opts.context.items || [],
                    index: (opts.context.index !== undefined) ? opts.context.index : -1
                };
            }

            var url = App.Content.streamUrl(item);
            if (!url) {
                setState(STATE.ERROR);
                App.Bus.emit('player:error', {
                    code: App.ERR.NOT_FOUND,
                    message: 'Bu icerik icin yayin adresi olusturulamadi.',
                    item: item
                });
                return Promise.resolve(false);
            }

            /* Kaldigi yerden devam (film / bolum) */
            seekPending = 0;
            if (item.type !== 'live') {
                if (opts.startMs) {
                    seekPending = opts.startMs;
                } else if (opts.resume !== false) {
                    var sec = App.History.resumeOf(item.key);
                    if (sec > 0) { seekPending = sec * 1000; }
                }
            }

            App.History.push(item);
            return startStream(item, url, false);
        },

        /** Listedeki i. ogeyi oynat */
        playIndex: function (i) {
            if (i < 0 || i >= context.items.length) { return Promise.resolve(false); }
            context.index = i;
            return P.play(context.items[i], { context: context });
        },

        /**
         * Kanal degistir. delta = +1 sonraki, -1 onceki
         * Liste sonuna gelince basa doner (canli TV aliskanligi).
         */
        zap: function (delta) {
            if (!context.items.length) { return Promise.resolve(false); }
            var n = context.items.length;
            var next = context.index + delta;
            if (next < 0) { next = n - 1; }
            if (next >= n) { next = 0; }
            return P.playIndex(next);
        },

        /** Kanal numarasi ile gecis (numpad) */
        zapToNumber: function (num) {
            for (var i = 0; i < context.items.length; i++) {
                if (U.toInt(context.items[i].num, -1) === num) { return P.playIndex(i); }
            }
            /* Numara bulunamadi -> sirasal indeks olarak dene */
            if (num >= 1 && num <= context.items.length) { return P.playIndex(num - 1); }
            return Promise.resolve(false);
        },

        /**
         * Duraklat / devam et.
         * Motor duraklatmayi reddederse (ornek: AVPlay canli yayinda) durum
         * DEGISTIRILMEZ; onceden ekranda "Duraklatildi" yazarken goruntu
         * akmaya devam ediyordu.
         * @returns {string} yeni durum
         */
        togglePause: function () {
            var eng = chooseEngine();
            if (state === STATE.PLAYING || state === STATE.BUFFERING) {
                if (eng.pause()) { setState(STATE.PAUSED); }
            } else if (state === STATE.PAUSED) {
                if (eng.resume()) { setState(STATE.PLAYING); }
            }
            return state;
        },

        /** Goreli sarma. Suren bir sarma varsa ONUN HEDEFINDEN devam eder. */
        seekBy: function (deltaMs) {
            var base = seekState.busy ? seekState.target : position;
            return engineSeek(base + deltaMs);
        },

        seekTo: function (ms) { return engineSeek(ms); },

        /** Sarma suruyor mu (veya az once bitti mi) */
        isSeeking: function () {
            return seekState.busy > 0 || Date.now() < seekState.settleUntil;
        },

        /** Hata ekranindaki "Tekrar Dene" */
        retry: function () {
            if (!current) { return Promise.resolve(false); }
            attempt = 0;
            triedAlt = false;
            lastError = null;
            var item = current.item;
            var url = App.Content.streamUrl(item);
            if (!current.isLive && position > 5000) { seekPending = position; }
            return startStream(item, url || current.url, false);
        },

        /** Ses/goruntu akisini yeniden baslat (donmus yayin icin) */
        restart: function () {
            if (!current) { return Promise.resolve(false); }
            log.info('akis yeniden baslatiliyor');
            var item = current.item;
            var url = current.url;
            /* Filmde/bolumde kalinan yerden devam et */
            if (!current.isLive && position > 5000) { seekPending = position; }
            chooseEngine().stop();
            attempt = 0;
            return startStream(item, url, false);
        },

        stop: function () {
            stopPositionSaver();
            if (prefTimer) { clearTimeout(prefTimer); prefTimer = null; }
            if (current && !current.isLive && position > 0) {
                App.History.updatePosition(current.item.key,
                    Math.floor(position / 1000), Math.floor(duration / 1000));
            }
            if (engine) { engine.stop(); }
            streamGen++;          /* bekleyen sonuc/zamanlayicilar gecersiz */
            current = null;
            position = 0;
            duration = 0;
            seekState = { busy: 0, target: -1, settleUntil: 0, settleTarget: 0 };
            setState(STATE.IDLE);
        },

        dispose: function () {
            stopPositionSaver();
            if (engine) { try { engine.dispose(); } catch (e) { } }
            engine = null;
            current = null;
            state = STATE.IDLE;
        },

        /* ---------- Sorgu ---------- */
        getState: function () { return state; },
        isPlaying: function () { return state === STATE.PLAYING || state === STATE.BUFFERING; },
        getItem: function () { return current ? current.item : null; },
        getUrl: function () { return current ? current.url : ''; },
        getPosition: function () { return position; },
        getDuration: function () { return duration; },
        getContext: function () { return context; },
        getIndex: function () { return context.index; },
        getLastError: function () { return lastError; },
        isLive: function () { return !!(current && current.isLive); },

        /* ---------- Parca (ses/altyazi) secimi ---------- */
        getTracks: function (type) {
            var all = chooseEngine().getTracks();
            if (!type) { return all; }
            return all.filter(function (t) { return t.type === type; });
        },

        selectTrack: function (type, index) {
            var ok = chooseEngine().selectTrack(type, index);
            if (ok) {
                selectedTrack[type] = index;
                manualPick[type] = true;   /* otomatik tercih bunu ezmesin */
            }
            return ok;
        },

        /**
         * Kullanicinin sectigi dili KALICI olarak hatirla.
         * @param {string} type 'AUDIO' | 'TEXT'
         * @param {string} lang dil kodu, altyazi icin 'off' de olabilir
         */
        rememberTrackLang: function (type, lang) {
            var key = (type === 'AUDIO') ? 'preferredAudioLang' : 'preferredSubtitleLang';
            App.Settings.set(key, lang || '');
            log.info('dil tercihi kaydedildi:', key, '=', lang || '(yok)');
        },

        getPreferredLang: function (type) {
            return App.Settings.get(type === 'AUDIO' ? 'preferredAudioLang' : 'preferredSubtitleLang');
        },

        applyTrackPreferences: applyTrackPreferences,

        /** Menude "secili" isaretini gosterebilmek icin */
        getSelectedTrack: function (type) { return selectedTrack[type]; },

        /** Altyazi katmanini gizle/goster (AVPlay setSilentSubtitle) */
        setSubtitleHidden: function (hidden) {
            subtitleHidden = !!hidden;
            manualPick.TEXT = true;        /* kullanici karari otomatige baskin */
            chooseEngine().setSubtitleHidden(hidden);
            if (hidden) { selectedTrack.TEXT = null; }
        },

        isSubtitleHidden: function () { return subtitleHidden; },

        /* ---------- Sonraki icerik (dizi bolumu / liste) ---------- */

        hasNext: function () { return hasNext(); },

        nextItem: function () {
            return hasNext() ? context.items[context.index + 1] : null;
        },

        /** Sonraki ogeye gec (otomatik bolum gecisi) */
        playNext: function () {
            if (!hasNext()) { return Promise.resolve(false); }
            return P.playIndex(context.index + 1);
        },

        /** Kalan sure (ms). Canli yayinda 0 doner. */
        remaining: function () {
            if (!duration || (current && current.isLive)) { return 0; }
            return Math.max(0, duration - position);
        },

        setDisplayMode: function (mode) {
            App.Settings.set('displayMode', mode);
            chooseEngine().setDisplayMethod(mode);
        },

        getBandwidth: function () { return chooseEngine().getBandwidth(); },

        setContext: function (items, index) {
            context = { items: items || [], index: (index === undefined ? -1 : index) };
        }
    };

    App.Player = P;
})(window.App = window.App || {});
