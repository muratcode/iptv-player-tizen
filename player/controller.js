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
   - Sarma hata verir, yanit vermez veya ardindan goruntu donarsa
     yayini kalinan yerden yeniden acmak (bkz. seekFailed)
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
    /* Basarili gorunen bir sarmadan sonra oynatma bu sure icinde hic
       ilerlemezse goruntu donmus sayilir. Tampon zaman asimi 10 sn
       (avplay.js setTimeoutForBuffering); arti pay. */
    var STALL_MS = 20000;
    /* Sarma HATA dondurduyse AVPlay eski konumda oynamaya devam etmeli;
       tampon beklenmez. Bu surede ilerlemezse takilmistir (gercek TV'de
       olculdu: bazi MKV'lerde reddedilen sarmadan sonra sure donup kalir,
       duraklat/devam da kurtarmaz). */
    var STALL_AFTER_ERROR_MS = 4000;

    var engine = null;            /* etkin motor */
    var baseEngine = null;        /* AVPlay (TV) veya HTML5 (PC) */
    var mseEngine = null;         /* sarma dizini okunamayan MKV'ler (player/mse.js) */
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
    var seekState = { busy: 0, target: -1, settleUntil: 0, settleTarget: 0, resume: false };

    /* Oynatmanin GERCEKTEN ulastigi son konum (ms). Gecmise ve "kaldigi
       yerden devam"a bu yazilir, sarma hedefi degil: onceden hedef
       yaziliyordu; sarilamayan bir noktada goruntu donunca bolum her
       acilista (ve MAVI tusla yeniden baslatinca) ayni noktaya sarip
       yine donuyordu. */
    var goodPos = 0;
    /* Kaldigi yerden devam sarmasi bekleniyor: o ana kadar 0'dan oynayan
       ilk kareler konum sayilmaz. */
    var resumeHold = false;
    /* Sarma bekcisi: sarma "basarili" donduktan sonra oynatma gercekten
       ilerliyor mu? {target, resume, lastMs, since, timer} */
    var watch = null;
    /* Bu oturumda sarmada sorun cikan icerikler.
       key -> {fails, noSeek: kullanici sarmasi kapali,
               noResume: kaldigi yere de gidilemiyor -> bastan oynat} */
    var seekTrouble = {};
    /* Yayin kurtarma icin yeniden acildi: elle secilen parcalar yeni
       oturumda varsayilana dondu, tekrar secilmeli. */
    var reselect = false;
    var startNotice = '';

    function setState(s) {
        if (state === s) { return; }
        state = s;
        App.Bus.emit('player:state', { state: s, item: current ? current.item : null });
    }

    function chooseEngine() {
        if (!engine) { engine = defaultEngine(); }
        return engine;
    }

    function defaultEngine() {
        if (!baseEngine) {
            if (App.AvPlayer.isAvailable()) {
                baseEngine = new App.AvPlayer();
                log.info('motor: AVPlay (Samsung donanim oynaticisi)');
            } else {
                baseEngine = new App.Html5Player();
                log.warn('motor: HTML5 <video> (webapis.avplay bulunamadi - PC tarayici modu)');
            }
            baseEngine.setHandlers(handlers);
        }
        return baseEngine;
    }

    function mseUsable() {
        return !!(App.MsePlayer && App.MsePlayer.isAvailable());
    }

    /**
     * Bu yayin icin motoru sec. Sarma dizini TV'nin okuyamayacagi MKV'ler
     * Media Source oynaticisiyla (player/mse.js) acilir; digerleri AVPlay.
     * Motor degisirken eskisi durdurulur (iki video katmani ayni anda
     * calismasin).
     */
    function engineFor(rec) {
        var want;
        if (rec.useMse) {
            if (!mseEngine) {
                mseEngine = new App.MsePlayer();
                mseEngine.setHandlers(handlers);
            }
            want = mseEngine;
        } else {
            want = defaultEngine();
        }
        if (engine && engine !== want) {
            try { engine.stop(); } catch (e) { log.warn('onceki motor durdurulamadi', e && e.message); }
        }
        engine = want;
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
            if (seekState.busy || resumeHold) { return; }
            if (Date.now() < seekState.settleUntil &&
                Math.abs((ms || 0) - seekState.settleTarget) > 10000) { return; }

            position = ms || 0;
            noteProgress(position);
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
            /* Sarma sirasinda veya hemen ardindan gelen hata bir sarma
               sorunudur: kalinan yerden kurtarilir (hedeften degil). */
            if (current && !current.isLive && (seekState.busy || watch)) {
                var t = seekState.busy ? seekState.target : watch.target;
                var res = seekState.busy ? seekState.resume : watch.resume;
                seekFailed(t, 'hata ' + code, res, true);
                return;
            }
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

        /* Yayin yeniden acildiysa elle secilen parcalari geri yukle
           (ayni dosya -> ayni indeksler). */
        if (reselect) {
            reselect = false;
            if (manualPick.AUDIO && selectedTrack.AUDIO !== null) {
                eng.selectTrack('AUDIO', selectedTrack.AUDIO);
            }
            if (manualPick.TEXT) {
                eng.setSubtitleHidden(subtitleHidden);
                if (!subtitleHidden && selectedTrack.TEXT !== null) {
                    eng.selectTrack('TEXT', selectedTrack.TEXT);
                }
            }
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
    function engineSeek(ms, isResume) {
        if (!current || current.isLive) { return Promise.resolve(false); }
        if (!isResume && !canSeek()) { return Promise.resolve(false); }
        var eng = chooseEngine();
        var max = duration > 0 ? Math.max(0, duration - 3000) : Math.max(0, ms);
        var target = U.clamp(Math.floor(ms), 0, max);

        var gen = streamGen;
        disarmWatch();
        seekState.busy++;
        seekState.target = target;
        seekState.resume = !!isResume;
        position = target;
        App.Bus.emit('player:time', { position: position, duration: duration, seeking: true });

        return eng.seekTo(target).then(function (ok) {
            if (gen !== streamGen) { return false; }   /* yayin degismis */
            if (isResume) { resumeHold = false; }
            seekState.busy = Math.max(0, seekState.busy - 1);
            if (seekState.busy) { return ok; }         /* daha yeni hedef yolda */

            seekState.target = -1;
            seekState.settleUntil = Date.now() + 1500;
            seekState.settleTarget = position;
            if (ok) {
                armWatch(target, seekState.resume);
            } else {
                var stuck = eng.lastSeekFail === 'timeout';
                seekFailed(target, stuck ? 'yanit yok' : 'hata', seekState.resume, stuck);
            }
            return ok;
        });
    }

    /* ---------------- Sarma sorunlari ---------------- */

    function trouble() {
        var key = current && current.item && current.item.key;
        if (!key) { return { fails: 0, noSeek: false, noResume: false, reason: '', useMse: false, verdict: '', kind: '' }; }
        if (!seekTrouble[key]) {
            seekTrouble[key] = { fails: 0, noSeek: false, noResume: false, reason: '', useMse: false, verdict: '', kind: '' };
        }
        return seekTrouble[key];
    }

    function canSeek() {
        return !!(current && !current.isLive && !trouble().noSeek);
    }

    function notice(text) { App.Bus.emit('player:notice', { text: text }); }

    /** Konum bildirimi geldi: oynatma ilerliyorsa bu konum "gercek"tir. */
    function noteProgress(ms) {
        if (watch) {
            if (watch.lastMs < 0) { watch.lastMs = ms; return; }
            if (Math.abs(ms - watch.lastMs) < 400) { return; }
            disarmWatch();                 /* ilerliyor: sarma tuttu */
        }
        goodPos = ms;
    }

    /** @param {number} [limitMs] ilerleme beklenecek sure (varsayilan STALL_MS) */
    function armWatch(target, isResume, limitMs) {
        disarmWatch();
        if (!current || current.isLive) { return; }
        var gen = streamGen;
        var limit = limitMs || STALL_MS;
        var w = { target: target, resume: !!isResume, lastMs: -1, since: Date.now(), timer: null };
        watch = w;
        w.timer = setInterval(function () {
            if (watch !== w || gen !== streamGen || !current ||
                state === STATE.ERROR || state === STATE.IDLE) {
                clearInterval(w.timer);
                if (watch === w) { watch = null; }
                return;
            }
            if (state === STATE.PAUSED) { w.since = Date.now(); return; }
            if (Date.now() - w.since < limit) { return; }
            disarmWatch();
            seekFailed(w.target, 'donma', w.resume, true);
        }, 1000);
    }

    function disarmWatch() {
        if (watch) { clearInterval(watch.timer); watch = null; }
    }

    /** Ayni yayini bastan ac (motor takildi); startMs > 5 sn ise oraya sar */
    function reload(startMs) {
        if (!current) { return; }
        var item = current.item;
        var url = current.url;
        seekPending = (!current.isLive && startMs > 5000) ? startMs : 0;
        App.Bus.emit('player:recovering', { reason: 'seek' });
        chooseEngine().stop();
        startStream(item, url, true);
    }

    /**
     * Sarma hata verdi, yanit vermedi veya ardindan goruntu dondu.
     * Oynatici hicbir durumda donuk birakilmaz:
     *  - kullanici sarmasi: gercekten oynatilan son konuma donulur;
     *    oynatici takildiysa yayin o noktadan yeniden acilir
     *  - ayni icerikte ikinci sorun: bu oturumda sarma kapatilir
     *  - kaldigi yerden devam sarmasi (yeni acilan yayinda bile)
     *    basarisiz: icerik sarilamiyor -> bastan oynatilir
     * @param {boolean} stuck oynatici takili, yayin yeniden acilmali
     */
    function seekFailed(target, reason, isResume, stuck) {
        if (!current || current.isLive) { return; }
        var rec = trouble();
        rec.fails++;
        if (rec.fails >= 2) { rec.noSeek = true; }
        if (isResume) { rec.noSeek = true; rec.noResume = true; }
        log.warn('sarma sorunu (' + reason + '): hedef ' + Math.round(target / 1000) + ' sn' +
                 ' | kalinan ' + Math.round(goodPos / 1000) + ' sn | sorun ' + rec.fails +
                 (rec.noSeek ? ' | sarma kapatildi' : ''));

        disarmWatch();
        resumeHold = false;
        seekState = { busy: 0, target: -1, settleUntil: 0, settleTarget: 0, resume: false };

        if (isResume) {
            /* Yeni acilan yayinda bile sarilamadi. Gercek TV'de reddedilen
               sarmadan sonra oynatici takili kalir (duraklat/devam da
               kurtarmaz): beklemeden bastan ac. */
            notice('Kaldiginiz yere gidilemedi, bastan oynatiliyor. ' +
                   'Bu icerikte ileri/geri sarma calismiyor.');
            reload(0);
            return;
        }

        position = goodPos;
        App.Bus.emit('player:time', { position: position, duration: duration });
        if (stuck && rec.noResume) {
            /* Kaldigi yere sarmak da calismiyor: tek secenek bastan acmak */
            notice('Goruntu dondu; yayin bastan yeniden aciliyor.');
            reload(0);
        } else if (stuck) {
            notice(rec.noSeek
                ? 'Bu icerikte ileri/geri sarma calismiyor; kaldiginiz yerden devam ediliyor.'
                : 'Sarma takildi; yayin kaldiginiz yerden yeniden aciliyor.');
            reload(goodPos);
        } else {
            notice(rec.noSeek ? 'Bu icerikte ileri/geri sarma calismiyor.' : 'Bu noktaya sarilamadi.');
            /* goruntu takildiysa kisa surede yeniden acilir */
            armWatch(goodPos, false, STALL_AFTER_ERROR_MS);
        }
    }

    /**
     * Oynaticinin SU ANKI konumu. "position" yarim saniyede bir gelen
     * bildirimle guncellenir; sarma hesabinda onu kullanmak 10 sn'lik
     * sarmayi ~9,5 sn yapiyordu. Sarma surerken veya hemen sonrasinda
     * (oynatici eski konumu bildirebilir) ve devam sarmasi beklenirken
     * bilinen konum kullanilir.
     */
    function livePosition() {
        if (!current || current.isLive || seekState.busy || resumeHold ||
            Date.now() < seekState.settleUntil || (state !== STATE.PLAYING && state !== STATE.PAUSED)) {
            return position;
        }
        var eng = chooseEngine();
        if (eng.isBusy && eng.isBusy()) { return position; }
        var t = 0;
        try { t = eng.getCurrentTime(); } catch (e) { t = 0; }
        /* Mantiksiz deger (0 veya bildirilenden cok farkli) -> bildirileni kullan */
        if (!(t > 0) || Math.abs(t - position) > 3000) { return position; }
        return t;
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
                Math.floor(goodPos / 1000), Math.floor(duration / 1000));
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
            if (!current.isLive && goodPos > 5000) { seekPending = goodPos; }
            log.info('yeniden deneme', attempt + '/' + RETRY_LIMIT);
            App.Bus.emit('player:recovering', { reason: 'retry', attempt: attempt });
            setTimeout(function () {
                if (gen === streamGen && current) { startStream(current.item, current.url, true); }
            }, RETRY_DELAY);
            return;
        }

        /* 3) Uygulama oynaticisi (MSE) tekrar tekrar hata verdiyse bu icerigi
              Samsung oynaticisiyla dene */
        var rec = trouble();
        if (engine === mseEngine && rec.useMse && !rec.noMse) {
            rec.noMse = true;
            attempt = 0;
            if (!current.isLive && goodPos > 5000) { seekPending = goodPos; }
            log.warn('MSE oynatici hata verdi, AVPlay ile yeniden aciliyor');
            App.Bus.emit('player:recovering', { reason: 'retry', attempt: 1 });
            setTimeout(function () {
                if (gen === streamGen && current) { startStream(current.item, current.url, true); }
            }, RETRY_DELAY);
            return;
        }

        /* 4) Pes et */
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
        var isLive = (item.type === 'live');
        var gen = ++streamGen;

        current = { item: item, url: url, isLive: isLive };
        if (!isRetry) { attempt = 0; triedAlt = false; lastError = null; }

        position = 0;
        duration = 0;
        disarmWatch();
        resumeHold = false;
        startNotice = '';
        seekState = { busy: 0, target: -1, settleUntil: 0, settleTarget: 0, resume: false };
        if (!isRetry) {
            selectedTrack = { AUDIO: null, TEXT: null };
            subtitleHidden = true;
            manualPick = { AUDIO: false, TEXT: false };
            reselect = false;
            /* Oynatma baslayana kadar "kaldigi yer" baslangic noktasidir */
            goodPos = isLive ? 0 : seekPending;
        } else {
            /* Yeniden acilan yayinda parcalar varsayilana doner: otomatik
               secilenler yeniden secilsin, elle secilenler geri yuklensin. */
            if (!manualPick.AUDIO) { selectedTrack.AUDIO = null; }
            if (!manualPick.TEXT) { selectedTrack.TEXT = null; }
            reselect = true;
        }

        setState(STATE.LOADING);

        var opts = {
            isLive: isLive,
            displayMode: App.Settings.get('displayMode'),
            use4K: App.Settings.get('mode4K') !== false,
            userAgent: App.Settings.get('userAgent') || ''
        };

        log.info('baslatiliyor:', item.name, '|', U.truncate(url, 100));

        return precheck(item, url).then(function () {
            if (gen !== streamGen) { return false; }

            /* Bu icerikte kaldigi yere sarilamiyorsa (dosya yapisi veya daha
               once basarisiz oldu) tekrar denenmez - goruntu donardi. */
            var rec = trouble();
            decideEngine(rec, item, url);
            if (!isLive && seekPending > 0 && rec.noResume) {
                seekPending = 0;
                startNotice = (rec.reason === 'index')
                    ? 'Bu bolumun dosyasi ileri/geri sarmayi desteklemiyor; bastan oynatiliyor.'
                    : 'Bu icerikte kaldiginiz yere gidilemiyor, bastan oynatiliyor.';
            }
            /* MSE oynaticisi kaldigi yerden dogrudan baslar (AVPlay yok sayar) */
            opts.startMs = (!isLive && seekPending > 0) ? seekPending : 0;
            return prepareAndPlay(engineFor(rec), item, url, opts, isLive, isRetry, gen);
        });
    }

    /**
     * MKV'de sarma dizini TV'nin okuyamayacagi bicimdeyse sarma ve
     * kaldigi yerden devam oynatmadan ONCE kapatilir (player/seekcheck.js).
     * Hesap tek baglantili olsa da sorun olmaz: istek AVPlay acilmadan
     * biter. Sonuc belirsizse hicbir sey degismez.
     */
    function precheck(item, url) {
        var rec = trouble();
        if (!App.SeekCheck || !current || current.isLive || rec.verdict) {
            return Promise.resolve();
        }
        return App.SeekCheck.check(item, url).then(function (v) {
            rec.verdict = v || 'unknown';
        }, function () { rec.verdict = 'unknown'; /* belirsiz: engelleme */ });
    }

    /**
     * Motor karari (her acilista; ayar degisirse bir sonraki acilista gecerli):
     *  - sarma dizini TV tarafindan okunamayan MKV -> MSE (zorunlu)
     *  - Ayarlar > Film/Dizi Oynaticisi = Uygulama oynaticisi -> tum MKV'ler MSE
     *  - digerleri, canli yayin ve MSE'nin acamadigi dosyalar -> AVPlay
     */
    function decideEngine(rec, item, url) {
        var mse = false;
        if (current && !current.isLive && mseUsable() && !rec.noMse) {
            var mkv = !!(App.SeekCheck && App.SeekCheck.isMkv(item, url));
            mse = rec.verdict === 'noindex' || (mkv && App.Settings.get('vodPlayer') === 'mse');
        }
        var kind = mse ? 'mse' : 'base';
        if (rec.kind && rec.kind !== kind) {
            /* Motor degisti: oncekinin sarma sorunlari bu motor icin gecerli degil */
            rec.fails = 0;
            rec.noSeek = false;
            rec.noResume = false;
            rec.reason = '';
        }
        if (mse && rec.kind !== 'mse') {
            log.info(rec.verdict === 'noindex'
                ? 'sarma dizini TV tarafindan okunamiyor; MSE oynaticisiyla aciliyor:'
                : 'Ayar: uygulama oynaticisi (MSE):', item.name);
        }
        rec.kind = kind;
        rec.useMse = mse;
        if (!mse && rec.verdict === 'noindex' && rec.reason !== 'index') { disableSeekForIndex(rec, item); }
    }

    function disableSeekForIndex(rec, item) {
        rec.useMse = false;
        rec.noSeek = true;
        rec.noResume = true;
        rec.reason = 'index';
        log.warn('bu dosyada sarma dizini TV tarafindan okunamiyor; sarma kapatildi:', item.name);
    }

    function prepareAndPlay(eng, item, url, opts, isLive, isRetry, gen) {
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
                resumeHold = true;
                setTimeout(function () {
                    if (gen === streamGen) { engineSeek(target, true); }
                }, 600);
            }

            startPositionSaver();

            /* Parca listesi ancak hazirlik bitince dolar; kisa bir gecikmeyle
               kayitli ses/altyazi dilini uygula. */
            schedulePrefs(900);

            App.Bus.emit('player:item', {
                item: item,
                index: context.index,
                total: context.items.length,
                retry: !!isRetry          /* ayni icerik yeniden acildi */
            });
            if (startNotice) { notice(startNotice); startNotice = ''; }
            return true;
        }, function (err) {
            if (gen !== streamGen) { return false; }
            var rec = trouble();
            if (eng === mseEngine && rec.useMse) {
                /* MSE acilamadi (desteklenmeyen kodek vb.): normal oynaticiyla ac.
                   Sarma dizini okunamayan dosyada sarma kapali olur (decideEngine). */
                log.warn('MSE oynatici acilamadi, AVPlay ile devam:', (err && (err.detail || err.message)) || '');
                rec.noMse = true;
                startStream(item, url, true);
                return false;
            }
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

            /* Kaldigi yerden devam (film / bolum).
               startMs SAYI olarak verildiyse (0 dahil) o uygulanir: "Bastan
               oynat" 0 gonderir. Onceden 0 "belirtilmemis" sayiliyor, otomatik
               devam acikken yine kayitli konuma sariliyordu. */
            seekPending = 0;
            if (item.type !== 'live') {
                if (typeof opts.startMs === 'number') {
                    seekPending = Math.max(0, opts.startMs);
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
            var base = seekState.busy ? seekState.target : livePosition();
            return engineSeek(base + deltaMs);
        },

        seekTo: function (ms) { return engineSeek(ms); },

        /** Bu icerikte sarma kullanilabilir mi (sorun cikinca kapanir) */
        canSeek: function () { return canSeek(); },

        /** Sarma kapaliyken kullaniciya gosterilecek aciklama */
        noSeekText: function () {
            return trouble().reason === 'index'
                ? 'Bu bolumun dosyasi ileri/geri sarmayi desteklemiyor'
                : 'Bu icerikte ileri/geri sarma calismiyor';
        },

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
            if (!current.isLive && goodPos > 5000) { seekPending = goodPos; }
            return startStream(item, url || current.url, false);
        },

        /** Ses/goruntu akisini yeniden baslat (donmus yayin icin) */
        restart: function () {
            if (!current) { return Promise.resolve(false); }
            log.info('akis yeniden baslatiliyor');
            var item = current.item;
            var url = current.url;
            /* Filmde/bolumde kalinan yerden devam et (gercekten oynatilan
               son konum; donmaya yol acan sarma hedefi degil) */
            if (!current.isLive && goodPos > 5000) { seekPending = goodPos; }
            chooseEngine().stop();
            attempt = 0;
            return startStream(item, url, false);
        },

        stop: function () {
            stopPositionSaver();
            if (prefTimer) { clearTimeout(prefTimer); prefTimer = null; }
            disarmWatch();
            if (current && !current.isLive && goodPos > 0) {
                App.History.updatePosition(current.item.key,
                    Math.floor(goodPos / 1000), Math.floor(duration / 1000));
            }
            if (engine) { engine.stop(); }
            streamGen++;          /* bekleyen sonuc/zamanlayicilar gecersiz */
            current = null;
            position = 0;
            duration = 0;
            goodPos = 0;
            resumeHold = false;
            seekState = { busy: 0, target: -1, settleUntil: 0, settleTarget: 0, resume: false };
            setState(STATE.IDLE);
        },

        dispose: function () {
            stopPositionSaver();
            disarmWatch();
            if (engine) { try { engine.dispose(); } catch (e) { } }
            engine = null;
            baseEngine = null;
            mseEngine = null;
            current = null;
            state = STATE.IDLE;
        },

        /* ---------- Sorgu ---------- */
        getState: function () { return state; },
        isPlaying: function () { return state === STATE.PLAYING || state === STATE.BUFFERING; },
        getItem: function () { return current ? current.item : null; },
        getUrl: function () { return current ? current.url : ''; },
        getPosition: function () { return position; },
        /** Sarma hesabi icin oynaticinin anlik konumu (bkz. livePosition) */
        getLivePosition: function () { return livePosition(); },
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
