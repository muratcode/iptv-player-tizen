/* ============================================================
   views/player.js
   TAM EKRAN OYNATICI

   Bu ekranin arka plani SEFFAFTIR; goruntu AVPlay'in donanim video
   duzleminden gelir (body.player-active sinifi sayfa arka planlarini
   kaldirir).

   OZELLIKLER
     - Hizlanan ileri/geri sarma: ard arda basildikca adim buyur
       (10sn -> 30sn -> 60sn -> 5dk). Tek tek seekTo cagirmak yerine
       hedef birikir ve 450 ms sonra TEK seek yapilir; bu hem cok daha
       hizli hissettirir hem de AVPlay'i yormaz.
     - Sonraki bolum: bolumun son saniyelerinde geri sayimli oneri.
       Ayni sezondaysa otomatik gecer, SEZON DEGISIYORSA sorar.
     - Intro atlama: bolumun basinda "Intro'yu Atla" onerisi.
       (Xtream/M3U intro zaman damgasi vermez; bu yuzden atlama suresi
        Ayarlar'dan belirlenen sabit degerdir - varsayilan 90 sn.)
     - Ses ve altyazi parcasi secimi; SECILI olan menude isaretlenir.

   Kumanda:
     OK             sirasiyla: sonraki bolum -> intro atla -> DURDUR/DEVAM
     INFO           bilgi seridini ac/kapat
     ▲ ▼ / CH+ CH-  kanal degistir (canli yayin)
     ◀ ▶            geri / ileri sar (basili tutunca hizlanir)
     ⏪ ⏩           1 dakika geri / ileri
     PLAY/PAUSE     duraklat / devam
     KIRMIZI        favorilere ekle/cikar
     YESIL          ses parcasi sec
     SARI           altyazi sec
     MAVI           yayini yeniden baslat (donma durumunda)
     0-9            kanal numarasi ile gecis
     RETURN         listeye don
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    var KEY = App.Keys.KEY;
    var log = App.Logger.get('PlayerView');

    App.Views = App.Views || {};

    /* ISO 639-2 dil kodlari -> Turkce adlar (menude okunakli olsun) */
    var LANGS = {
        tur: 'Turkce', tr: 'Turkce', tuk: 'Turkce',
        eng: 'Ingilizce', en: 'Ingilizce',
        ger: 'Almanca', deu: 'Almanca', de: 'Almanca',
        fre: 'Fransizca', fra: 'Fransizca', fr: 'Fransizca',
        spa: 'Ispanyolca', es: 'Ispanyolca',
        ita: 'Italyanca', it: 'Italyanca',
        rus: 'Rusca', ru: 'Rusca',
        ara: 'Arapca', ar: 'Arapca',
        kur: 'Kurtce', aze: 'Azerice',
        jpn: 'Japonca', kor: 'Korece', chi: 'Cince', zho: 'Cince',
        por: 'Portekizce', nld: 'Felemenkce', dut: 'Felemenkce',
        gre: 'Yunanca', ell: 'Yunanca', bul: 'Bulgarca', ron: 'Romence',
        srp: 'Sirpca', hrv: 'Hirvatca', pol: 'Lehce', ukr: 'Ukraynaca',
        fas: 'Farsca', per: 'Farsca', hin: 'Hintce', urd: 'Urduca'
    };

    function langName(code, fallback) {
        if (!code) { return fallback; }
        var k = String(code).toLowerCase().replace(/[^a-z]/g, '');
        return LANGS[k] || code.toUpperCase();
    }

    App.Views.player = function () {
        var root, osd, stateBox, nextUpEl, introEl, seekEl, subEl, subTextEl;
        var subTimer = null;
        var elLogo, elNum, elName, elNow, elNext, elBadges;
        var elBar, elFill, elCur, elDur;
        var osdTimer = null, clockTimer = null;
        var numBuffer = '', numTimer = null, numEl = null;
        var errorButtons = [];
        var destroyed = false;
        var currentItem = null;
        var returnTo = null;

        /* Sarma zinciri: ard arda basislarda adim buyur, tek seek yap */
        var seek = { n: 0, last: 0, target: 0, timer: null, hideTimer: null };

        /* Sonraki bolum onerisi */
        var nextUp = { open: false, timer: null, left: 0, dismissed: false, needsConfirm: false };

        /* Intro atlama onerisi */
        var intro = { visible: false, dismissed: false };

        /* Toplu sezon indirme durumu */
        var batch = { running: false, cancel: false };

        /* Altyazi bekleme gozcusu:
           Bir altyazi parcasi secildikten sonra AVPlay'den metin gelmiyorsa
           bu, parcanin GORUNTU TABANLI (DVB-SUB / PGS / VobSub) olmasindan
           kaynaklanir - AVPlay bu turleri metin olarak vermez. Kullanici
           "altyaziyi actim ama cikmiyor" diye takilmasin diye aciklariz. */
        var subWatch = { timer: null, gotAny: false };

        /* ================= OSD ================= */

        function buildOsd() {
            osd = U.el('div', 'osd');

            var top = U.el('div', 'osd__top');
            elLogo = U.el('div', 'osd__logo');
            var head = U.el('div', 'osd__head');
            elNum = U.el('div', 'osd__num', '');
            elName = U.el('div', 'osd__name', '');
            elNow = U.el('div', 'osd__now', '');
            elNext = U.el('div', 'osd__next', '');
            head.appendChild(elNum);
            head.appendChild(elName);
            head.appendChild(elNow);
            head.appendChild(elNext);
            elBadges = U.el('div', 'osd__badges');
            top.appendChild(elLogo);
            top.appendChild(head);
            top.appendChild(elBadges);
            osd.appendChild(top);

            var bottom = U.el('div', 'osd__bottom');
            elBar = U.el('div', 'pbar');
            elFill = U.el('div', 'pbar__fill');
            elBar.appendChild(elFill);
            bottom.appendChild(elBar);

            var times = U.el('div', 'osd__times');
            elCur = U.el('span', '', '0:00');
            elDur = U.el('span', '', '0:00');
            times.appendChild(elCur);
            times.appendChild(elDur);
            bottom.appendChild(times);

            var hints = U.el('div', 'osd__hints');
            hints.innerHTML =
                '<span class="hint"><span class="hint__key">OK</span> Durdur / Devam</span>' +
                '<span class="hint"><span class="hint__key">◀ ▶</span> Sar</span>' +
                '<span class="hint"><span class="hint__key">KIRMIZI</span> Favori</span>' +
                '<span class="hint"><span class="hint__key">YESIL</span> Ses</span>' +
                '<span class="hint"><span class="hint__key">SARI</span> Altyazi</span>' +
                '<span class="hint"><span class="hint__key">MAVI</span> Yeniden baslat</span>';
            bottom.appendChild(hints);

            osd.appendChild(bottom);
            return osd;
        }

        function showOsd(sticky) {
            if (!osd) { return; }
            if (!osd.classList.contains('is-visible')) {
                osd.classList.add('is-visible');
                paintProgress();
            }
            if (osdTimer) { clearTimeout(osdTimer); osdTimer = null; }
            if (!sticky) {
                var sec = U.toInt(App.Settings.get('osdTimeout'), 6);
                osdTimer = setTimeout(hideOsd, Math.max(2, sec) * 1000);
            }
        }

        function hideOsd() {
            if (osd) { osd.classList.remove('is-visible'); }
            if (osdTimer) { clearTimeout(osdTimer); osdTimer = null; }
        }

        function osdVisible() { return !!(osd && osd.classList.contains('is-visible')); }

        function toggleOsd() {
            if (osdVisible()) { hideOsd(); } else { showOsd(); }
        }

        /* ================= Bilgi ================= */

        function fillItemInfo(item) {
            currentItem = item;
            if (!item) { return; }

            App.UI.ImageLoader.into(elLogo, item.logo, U.initials(item.name));

            var isLive = item.type === 'live';
            elNum.textContent = isLive && item.num ? ('KANAL ' + item.num) : typeLabel(item);
            elName.textContent = displayName(item);
            elNow.textContent = '';
            elNext.textContent = '';

            U.empty(elBadges);
            if (isLive) { elBadges.appendChild(U.el('span', 'badge badge--live', 'CANLI')); }
            if (App.Favorites.has(item)) { elBadges.appendChild(U.el('span', 'badge', '★')); }

            lastProg = null;
            elFill.style.width = '0%';
            if (isLive) {
                elCur.textContent = '';
                elDur.textContent = '';
                loadEpg(item);
            } else {
                elCur.textContent = '0:00';
                elDur.textContent = '--:--';
            }
        }

        /** Bolumlerde dizi adini da goster */
        function displayName(item) {
            if (item.type === 'episode' && item.seriesName) {
                return item.seriesName + '  —  ' + item.name;
            }
            return item.name;
        }

        function typeLabel(item) {
            if (item.type === 'movie') { return 'FILM'; }
            if (item.type === 'episode') {
                var s = item.season ? ('SEZON ' + item.season) : '';
                var e = item.episodeNum ? ('BOLUM ' + item.episodeNum) : '';
                return (s + (s && e ? '  •  ' : '') + e) || 'BOLUM';
            }
            return '';
        }

        function loadEpg(item) {
            App.EPG.forChannel(item).then(function (nn) {
                if (destroyed || !currentItem || currentItem.key !== item.key) { return; }
                if (nn && nn.now) {
                    elNow.textContent = 'Simdi: ' + nn.now.title + '   ' + App.EPG.timeRange(nn.now);
                    var pct = App.EPG.progressOf(nn.now);
                    elFill.style.width = Math.round(pct * 100) + '%';
                    elCur.textContent = U.hhmm(nn.now.start);
                    elDur.textContent = nn.now.stop ? U.hhmm(nn.now.stop) : '';
                } else {
                    elNow.textContent = 'Program bilgisi bulunamadi';
                    elFill.style.width = '0%';
                }
                elNext.textContent = (nn && nn.next) ? ('Sonraki: ' + nn.next.title) : '';
            });
        }

        /* Son bilinen ilerleme. Bilgi seridi KAPALIYKEN DOM guncellenmez
           (oynatici her ~0.5 sn konum bildirir; gorunmeyen seride yazmak
           TV'de bosuna stil/yerlesim hesabi demektir). Serit acilinca
           bu degerle bir kez cizilir. */
        var lastProg = null;

        function updateProgress(position, duration) {
            if (!currentItem || currentItem.type === 'live') { return; }
            lastProg = { p: position, d: duration || 0 };
            if (osdVisible()) { paintProgress(); }
        }

        function paintProgress() {
            if (!lastProg || !currentItem || currentItem.type === 'live') { return; }
            var d = lastProg.d;
            var cur = U.duration(lastProg.p / 1000);
            var dur = d ? U.duration(d / 1000) : '--:--';
            if (elCur.textContent !== cur) { elCur.textContent = cur; }
            if (elDur.textContent !== dur) { elDur.textContent = dur; }
            elFill.style.width = d ? (Math.min(100, lastProg.p * 100 / d) + '%') : '0%';
        }

        /* ================= Hizlanan sarma ================= */

        function seekStepFor(n) {
            var base = Math.max(5, U.toInt(App.Settings.get('seekStep'), 10));
            if (n > 9) { return base * 30; }   /* 5 dk  */
            if (n > 6) { return base * 12; }   /* 2 dk  */
            if (n > 3) { return base * 6; }    /* 1 dk  */
            if (n > 1) { return base * 3; }    /* 30 sn */
            return base;                       /* 10 sn */
        }

        /**
         * @param {number} dir +1 ileri, -1 geri
         * @param {number} [fixedSec] verilirse adim buyumez (⏪ ⏩ tuslari: 1 dk)
         */
        function doSeek(dir, fixedSec) {
            if (App.Player.isLive()) { showOsd(); return; }

            var dur = App.Player.getDuration();
            if (!dur) { return; }

            var now = Date.now();
            /* 1.2 sn'den uzun aradan sonra zincir sifirlanir.
               Baslangic noktasi oynaticinin konumudur; bir sarma hala
               suruyorsa controller burada o sarmanin HEDEFINI dondurur
               (eski konumdan hesaplayip geri ziplamayiz). */
            if (now - seek.last > 1200) {
                seek.n = 0;
                seek.target = App.Player.getPosition();
            }
            seek.last = now;
            seek.n++;

            var stepSec = fixedSec || seekStepFor(seek.n);
            seek.target = U.clamp(seek.target + dir * stepSec * 1000, 0, Math.max(0, dur - 3000));

            showSeekPreview(dir, stepSec);
            showOsd(true);
            updateProgress(seek.target, dur);

            /* Tek tek seekTo cagirmak yerine 450 ms bekleyip TEK atlama yap */
            if (seek.timer) { clearTimeout(seek.timer); }
            seek.timer = setTimeout(function () {
                seek.timer = null;
                App.Player.seekTo(seek.target);
                showOsd();
            }, 450);
        }

        function showSeekPreview(dir, stepSec) {
            if (!seekEl) {
                seekEl = U.el('div', 'seekpv');
                root.appendChild(seekEl);
            }
            var label = stepSec >= 60
                ? (Math.round(stepSec / 60) + ' dk')
                : (stepSec + ' sn');
            seekEl.textContent = (dir > 0 ? '⏩  +' : '⏪  −') + label +
                                 '   ' + U.duration(seek.target / 1000);
            seekEl.classList.add('is-visible');

            if (seek.hideTimer) { clearTimeout(seek.hideTimer); }
            seek.hideTimer = setTimeout(function () {
                if (seekEl) { seekEl.classList.remove('is-visible'); }
            }, 1100);
        }

        /* ================= Sonraki bolum ================= */

        function nextIsNewSeason() {
            var nx = App.Player.nextItem();
            if (!nx || !currentItem) { return false; }
            return nx.type === 'episode' && currentItem.type === 'episode' &&
                   U.toInt(nx.season, 0) !== U.toInt(currentItem.season, 0);
        }

        function buildNextUp() {
            nextUpEl = U.el('div', 'nextup');
            root.appendChild(nextUpEl);
            return nextUpEl;
        }

        /**
         * @param {number} secondsLeft geri sayim; 0 ise "elle onay" modu
         */
        function showNextUp(secondsLeft) {
            var nx = App.Player.nextItem();
            if (!nx) { return; }

            nextUp.open = true;
            nextUp.left = secondsLeft;
            /* Sezon degisiyorsa VEYA otomatik gecis kapaliysa kullanici
               onaylamadan gecilmez. */
            nextUp.needsConfirm = nextIsNewSeason() ||
                                  !App.Settings.get('autoNextEpisode') ||
                                  secondsLeft <= 0;

            U.empty(nextUpEl);

            var title = nextIsNewSeason()
                ? ('Sezon ' + U.toInt(currentItem.season, 0) + ' bitti')
                : 'Sonraki bolum';
            nextUpEl.appendChild(U.el('div', 'nextup__label', title));

            var name = nx.type === 'episode'
                ? ('S' + U.pad2(nx.season) + 'B' + U.pad2(nx.episodeNum) + '  ' + nx.name)
                : nx.name;
            nextUpEl.appendChild(U.el('div', 'nextup__name', name));

            var line;
            if (nextIsNewSeason()) {
                line = 'Sezon ' + U.toInt(nx.season, 0) + ' baslasin mi?   OK: Evet   RETURN: Hayir';
            } else if (nextUp.needsConfirm) {
                line = 'OK: Sonraki bolumu baslat   •   RETURN: Kapat';
            } else {
                line = secondsLeft + ' saniye icinde basliyor   •   OK: Hemen baslat   RETURN: Iptal';
            }
            var cd = U.el('div', 'nextup__cd', line);
            cd.setAttribute('data-cd', '1');
            nextUpEl.appendChild(cd);

            nextUpEl.classList.add('is-visible');
        }

        function updateNextUpCountdown(secondsLeft) {
            if (!nextUp.open || nextUp.needsConfirm) { return; }
            nextUp.left = secondsLeft;
            var cd = nextUpEl.querySelector('[data-cd]');
            if (cd) {
                cd.textContent = secondsLeft +
                    ' saniye icinde basliyor   •   OK: Hemen baslat   RETURN: Iptal';
            }
        }

        function hideNextUp() {
            nextUp.open = false;
            if (nextUpEl) {
                nextUpEl.classList.remove('is-visible');
                U.empty(nextUpEl);
            }
        }

        function playNext() {
            hideNextUp();
            hideIntro();
            nextUp.dismissed = false;
            intro.dismissed = false;
            showBuffering('Sonraki bolum aciliyor...');
            App.Player.playNext();
        }

        /* ================= Altyazi cizimi =================
           AVPlay altyaziyi EKRANA CIZMEZ; yalnizca metni ve gosterim
           suresini onsubtitlechange olayiyla bildirir. Cizim isi burada.  */

        function buildSubtitle() {
            subEl = U.el('div', 'subtitle');
            subTextEl = U.el('span', 'subtitle__text');
            subEl.appendChild(subTextEl);
            root.appendChild(subEl);
            return subEl;
        }

        /**
         * @param {string} text
         * @param {number} durationMs 0 ise otomatik gizleme YAPILMAZ
         *                 (harici altyazida satiri biz yonetiriz)
         * @param {boolean} [persist] true ise zamanlayici kurulmaz
         */
        function showSubtitle(text, durationMs, persist) {
            if (subTimer) { clearTimeout(subTimer); subTimer = null; }

            var clean = String(text || '')
                .replace(/<[^>]+>/g, '')        /* bazi kaynaklar HTML etiketi gonderir */
                .replace(/\\N/g, '\n')           /* ASS/SSA satir sonu */
                .trim();

            if (!clean) { hideSubtitle(); return; }

            /* Ayni metni tekrar yazma: her saniyede DOM guncellemesi olmasin */
            if (subTextEl.textContent !== clean) {
                subTextEl.textContent = clean;
            }
            subEl.classList.add('is-visible');

            if (persist) { return; }

            /* Sure verilmisse o kadar goster; verilmemisse bir sonraki
               olay gelene kadar ekranda kalsin (en fazla 8 sn). */
            var ms = durationMs > 0 ? durationMs : 8000;
            subTimer = setTimeout(hideSubtitle, ms);
        }

        /** Indirilen (harici) altyazi: konuma gore satiri sec ve yaz */
        function renderExternalSubtitle(positionMs) {
            var txt = App.Subtitles.textAt(positionMs);
            if (txt) { showSubtitle(txt, 0, true); }
            else if (subEl && subEl.classList.contains('is-visible')) { hideSubtitle(); }
        }

        function hideSubtitle() {
            if (subTimer) { clearTimeout(subTimer); subTimer = null; }
            if (subEl) {
                subEl.classList.remove('is-visible');
                subTextEl.textContent = '';
            }
        }

        function onSubtitleEvt(d) {
            if (destroyed) { return; }
            subWatch.gotAny = true;
            if (subWatch.timer) { clearTimeout(subWatch.timer); subWatch.timer = null; }
            showSubtitle(d.text, d.duration);
        }

        /** Altyazi acildiktan sonra metin gelmezse aciklayici uyari goster */
        function watchSubtitleArrival() {
            if (subWatch.timer) { clearTimeout(subWatch.timer); }
            subWatch.gotAny = false;
            subWatch.timer = setTimeout(function () {
                subWatch.timer = null;
                if (destroyed || subWatch.gotAny) { return; }
                App.UI.Toast.warn(
                    'Bu altyazi goruntu tabanli olabilir (DVB/PGS). Televizyon bu turu ' +
                    'metin olarak vermedigi icin gosterilemiyor. Varsa baska bir dil deneyin.',
                    7000);
            }, 12000);
        }

        /* ================= Intro atlama ================= */

        function buildIntro() {
            introEl = U.el('div', 'introskip');
            introEl.appendChild(U.el('span', '', '⏭'));
            introEl.appendChild(U.el('span', '', ' Intro\'yu Atla  '));
            introEl.appendChild(U.el('span', 'introskip__key', 'OK'));
            root.appendChild(introEl);
            return introEl;
        }

        function showIntro() {
            if (intro.visible) { return; }
            intro.visible = true;
            introEl.classList.add('is-visible');
        }

        function hideIntro() {
            intro.visible = false;
            if (introEl) { introEl.classList.remove('is-visible'); }
        }

        function skipIntro() {
            var sec = Math.max(10, U.toInt(App.Settings.get('introSkipSeconds'), 90));
            hideIntro();
            intro.dismissed = true;
            App.Player.seekTo(sec * 1000);
            App.UI.Toast.info('Intro atlandi (' + sec + ' sn)');
            showOsd();
        }

        /**
         * Intro onerisi yalnizca:
         *   - dizi bolumu ise
         *   - suresi 10 dakikadan uzunsa
         *   - konum 5. saniye ile atlama noktasinin 15 sn oncesi arasindaysa
         * gosterilir.
         */
        function updateIntroPrompt(posSec, durSec) {
            if (!App.Settings.get('showIntroSkip') || intro.dismissed) { return; }
            if (!currentItem || currentItem.type !== 'episode') { return; }
            if (durSec < 600) { return; }

            var target = Math.max(10, U.toInt(App.Settings.get('introSkipSeconds'), 90));
            if (posSec > 5 && posSec < target - 15) { showIntro(); }
            else { hideIntro(); }
        }

        /* ================= Durum kutusu ================= */

        function clearState() {
            U.empty(stateBox);
            stateBox.classList.add('hidden');
            errorButtons = [];
        }

        /**
         * @param {string} text
         * @param {boolean} [compact] sarma sonrasi kisa bekleme: kucuk
         *        gosterge, icerik adi yok (her sarmada ekranin ortasina
         *        buyuk kutu cikmasi "dondu" hissi veriyordu)
         */
        function showBuffering(text, compact) {
            U.empty(stateBox);
            stateBox.classList.remove('hidden');
            errorButtons = [];
            bufCompact = !!compact;
            var box = U.el('div', compact ? 'pstate__wait' : 'pstate__load');
            box.appendChild(U.el('div', compact ? 'spinner spinner--sm' : 'spinner'));
            box.appendChild(U.el('div', 'loading__msg', text || 'Yayin aciliyor...'));
            if (currentItem && !compact) {
                box.appendChild(U.el('div', 'loading__sub', displayName(currentItem)));
            }
            stateBox.appendChild(box);
        }
        var bufCompact = false;

        function showError(info) {
            U.empty(stateBox);
            stateBox.classList.remove('hidden');
            errorButtons = [];

            var box = U.el('div', 'pstate__box');
            box.appendChild(U.el('div', 'pstate__title', 'Yayin acilamadi'));

            var msg = info.message || 'Bilinmeyen hata.';
            if (currentItem) { msg = displayName(currentItem) + '\n\n' + msg; }
            if (info.detail) { msg += '\n\n(' + info.detail + ')'; }
            box.appendChild(U.el('div', 'pstate__msg', msg));

            var btns = U.el('div', 'pstate__btns');

            var retry = U.el('button', 'btn btn--primary', 'Tekrar Dene');
            App.Nav.bind(retry, function () {
                showBuffering('Yeniden deneniyor...');
                App.Player.retry();
            }, { isDefault: true });
            btns.appendChild(retry);
            errorButtons.push(retry);

            if (App.Player.getContext().items.length > 1) {
                var next = U.el('button', 'btn', App.Player.isLive() ? 'Sonraki Kanal' : 'Sonraki Bolum');
                App.Nav.bind(next, function () {
                    showBuffering('Aciliyor...');
                    App.Player.zap(1);
                });
                btns.appendChild(next);
                errorButtons.push(next);
            }

            var back = U.el('button', 'btn', 'Listeye Don');
            App.Nav.bind(back, function () { App.Router.back(); });
            btns.appendChild(back);
            errorButtons.push(back);

            box.appendChild(btns);
            stateBox.appendChild(box);

            App.Nav.focus(retry);
        }

        /* ================= Olay dinleyicileri ================= */

        function onState(d) {
            if (destroyed) { return; }
            switch (d.state) {
                case App.Player.STATE.LOADING:
                    showBuffering('Yayin aciliyor...');
                    showOsd(true);
                    break;
                case App.Player.STATE.BUFFERING:
                    if (App.Player.isSeeking()) { showBuffering('Yukleniyor...', true); }
                    else { showBuffering('Arabellek dolduruluyor...'); }
                    break;
                case App.Player.STATE.PLAYING:
                    clearState();
                    showOsd();
                    break;
                case App.Player.STATE.PAUSED:
                    U.empty(stateBox);
                    stateBox.classList.remove('hidden');
                    var p = U.el('div', 'pstate__box');
                    p.appendChild(U.el('div', 'pstate__title', '⏸  Duraklatildi'));
                    stateBox.appendChild(p);
                    showOsd(true);
                    break;
                case App.Player.STATE.IDLE:
                    clearState();
                    break;
            }
        }

        function onTime(d) {
            if (destroyed) { return; }
            /* Sarma sirasinda ilerleme cubugunu hedefe gore gosteriyoruz */
            if (!seek.timer) { updateProgress(d.position, d.duration); }

            if (!d.duration || App.Player.isLive()) { return; }
            /* Hata kutusu acikken oneri kartlari (sonraki bolum / intro) cikmasin */
            if (errorButtons.length) { return; }

            /* Indirilen altyazi etkinse satirlari konuma gore biz yonetiriz */
            if (App.Subtitles.isActive()) { renderExternalSubtitle(d.position); }

            var posSec = d.position / 1000;
            var durSec = d.duration / 1000;
            var remain = Math.ceil(durSec - posSec);

            updateIntroPrompt(posSec, durSec);

            /* Sonraki bolum onerisi */
            var cd = Math.max(3, U.toInt(App.Settings.get('nextEpisodeCountdown'), 10));
            if (App.Player.hasNext() && !nextUp.dismissed && remain > 0 && remain <= cd) {
                if (!nextUp.open) { showNextUp(remain); }
                else { updateNextUpCountdown(remain); }
            } else if (nextUp.open && remain > cd) {
                hideNextUp();
            }
        }

        function onItem(d) {
            if (destroyed) { return; }
            /* Yeni icerik -> onerileri sifirla */
            hideNextUp();
            hideIntro();
            hideSubtitle();
            /* Indirilen altyazi onceki bolume aitti - yenisinde gecerli degil */
            App.Subtitles.clear();
            nextUp.dismissed = false;
            intro.dismissed = false;
            seek.n = 0;

            fillItemInfo(d.item);
            showOsd();
            autoLoadCachedSubtitle(d.item);
        }

        /**
         * Bu bolum/film icin daha once altyazi indirilmisse CIHAZDAN yukle.
         * Internete cikilmaz, indirme hakki harcanmaz.
         */
        function autoLoadCachedSubtitle(item) {
            if (!App.Settings.get('autoLoadCachedSubtitle')) { return; }
            if (!item || item.type === 'live') { return; }

            App.SubtitleCache.get(item).then(function (rec) {
                if (destroyed || !rec || !rec.text) { return; }
                var cur = App.Player.getItem();
                if (!cur || cur.key !== item.key) { return; }   /* icerik degismis */

                try {
                    var n = App.Subtitles.load(rec.text, { name: rec.name, language: rec.language });
                    App.Player.setSubtitleHidden(true);   /* gomulu kapali; biz ciziyoruz */
                    App.UI.Toast.info('Kayitli altyazi yuklendi (' + n + ' satir)', 4000);
                } catch (e) {
                    App.SubtitleCache.remove(item);       /* bozuksa at */
                }
            });
        }

        function onComplete(d) {
            if (destroyed) { return; }

            if (!d.hasNext) {
                hideNextUp();
                App.UI.Toast.info('Oynatma tamamlandi');
                setTimeout(function () { if (!destroyed) { App.Router.back(); } }, 1500);
                return;
            }

            /* Sezon degisiyorsa kullaniciya sor, ayni sezonda otomatik gec */
            if (!App.Settings.get('autoNextEpisode') || nextUp.dismissed || nextIsNewSeason()) {
                if (!nextUp.open) { showNextUp(0); }
                return;
            }
            playNext();
        }

        function onError(d) {
            if (destroyed) { return; }
            log.error('oynatma hatasi', d.code, d.detail);
            hideNextUp();
            hideIntro();
            showError(d);
        }

        function onRecovering(d) {
            if (destroyed) { return; }
            showBuffering(d.reason === 'format'
                ? 'Alternatif yayin formati deneniyor...'
                : 'Baglanti yeniden kuruluyor...');
        }

        function onBuffering(d) {
            if (destroyed) { return; }
            var msgEl = stateBox.querySelector('.loading__msg');
            if (msgEl && !bufCompact && d.percent !== undefined && d.percent < 100) {
                msgEl.textContent = 'Arabellek dolduruluyor... %' + d.percent;
            }
        }

        /* ================= Eylemler ================= */

        function togglePause() {
            var before = App.Player.getState();
            var after = App.Player.togglePause();
            var S = App.Player.STATE;
            if (before === after && App.Player.isLive() &&
                (before === S.PLAYING || before === S.BUFFERING)) {
                App.UI.Toast.info('Canli yayin duraklatilamiyor');
            }
            showOsd();
        }

        function zap(delta) {
            if (!App.Player.getContext().items.length) { return; }
            showBuffering(App.Player.isLive() ? 'Kanal degistiriliyor...' : 'Aciliyor...');
            showOsd();
            App.Player.zap(delta);
        }

        function toggleFav() {
            var item = App.Player.getItem();
            if (!item) { return; }
            var on = App.Favorites.toggle(item);
            App.UI.Toast.info(on ? '★ Favorilere eklendi' : 'Favorilerden cikarildi');
            fillItemInfo(item);
            showOsd();
        }

        function chooseAudioTrack() {
            var tracks = App.Player.getTracks('AUDIO');
            if (!tracks.length) {
                App.UI.Toast.warn('Bu yayinda secilebilir ses parcasi bulunamadi');
                return;
            }

            var cur = App.Player.getSelectedTrack('AUDIO');
            /* Hicbir secim yapilmadiysa ilk parca calisiyordur */
            if (cur === null || cur === undefined) { cur = tracks[0].index; }

            var opts = [], defaultIndex = 0;
            for (var i = 0; i < tracks.length; i++) {
                var t = tracks[i];
                var isCur = (t.index === cur);
                if (isCur) { defaultIndex = i; }
                opts.push({
                    icon: isCur ? '✔' : '🔈',
                    label: langName(t.language, 'Ses ' + (i + 1)) +
                           (t.label ? ('   (' + t.label + ')') : ''),
                    hint: isCur ? 'CALIYOR' : '',
                    current: isCur,
                    value: t.index
                });
            }

            App.UI.Modal.choose('Ses Parcasi', opts, {
                message: 'Su an calan parca ✔ ile isaretlidir.',
                defaultIndex: defaultIndex
            }).then(function (idx) {
                if (idx === undefined) { return; }
                if (App.Player.selectTrack('AUDIO', idx)) {
                    /* Secilen DILI hatirla: sonraki bolum/filmde otomatik uygulanir.
                       (Indeks degil dil kaydedilir; indeks her dosyada degisir.) */
                    var picked = null;
                    for (var k = 0; k < tracks.length; k++) {
                        if (tracks[k].index === idx) { picked = tracks[k]; }
                    }
                    App.Player.rememberTrackLang('AUDIO', picked && picked.language);
                    App.UI.Toast.success('Ses: ' +
                        langName(picked && picked.language, 'degistirildi') +
                        '  (sonraki bolumlerde de kullanilacak)');
                } else {
                    App.UI.Toast.error('Ses parcasi degistirilemedi');
                }
            });
        }

        function chooseSubtitle() {
            var tracks = App.Player.getTracks('TEXT');
            var external = App.Subtitles.isActive();

            /* Gomulu altyazi olmasa bile menu ACILIR: internetten indirme
               secenegi tam da bu durum icin vardir. */
            var hidden = App.Player.isSubtitleHidden();
            var cur = App.Player.getSelectedTrack('TEXT');

            var offNow = hidden && !external;
            var opts = [{
                icon: offNow ? '✔' : '🚫',
                label: 'Altyazi Kapali',
                hint: offNow ? 'ETKIN' : '',
                current: offNow,
                value: -1
            }];
            var defaultIndex = 0;

            /* Indirilen altyazi varsa listenin basinda gosterilir */
            if (external) {
                var xi = App.Subtitles.info();
                opts.push({
                    icon: '✔',
                    label: 'Indirilen altyazi' + (xi && xi.name ? ('  —  ' + U.truncate(xi.name, 40)) : ''),
                    hint: 'ETKIN',
                    current: true,
                    value: 'external'
                });
                defaultIndex = 1;
                opts.push({
                    icon: '⏱',
                    label: 'Gecikmeyi ayarla' +
                           (xi && xi.offset ? ('   (' + (xi.offset > 0 ? '+' : '') +
                                               (xi.offset / 1000).toFixed(1) + ' sn)') : ''),
                    value: 'offset'
                });
            }

            for (var i = 0; i < tracks.length; i++) {
                var t = tracks[i];
                var isCur = (!hidden && !external && t.index === cur);
                if (isCur) { defaultIndex = opts.length; }
                opts.push({
                    icon: isCur ? '✔' : '💬',
                    label: langName(t.language, 'Altyazi ' + (i + 1)),
                    hint: isCur ? 'ETKIN' : '',
                    current: isCur,
                    value: t.index
                });
            }

            /* Internetten indirme - canli yayin disinda anlamli */
            var playing = App.Player.getItem();
            if (playing && playing.type !== 'live') {
                opts.push({
                    icon: '🌐',
                    label: 'Internetten altyazi indir',
                    hint: App.OpenSubtitles.isConfigured() ? '' : 'AYAR GEREKLI',
                    value: 'download'
                });
            }
            /* Dizi izleniyorsa sezonun tamamini bir kerede indir */
            if (playing && playing.type === 'episode' && seasonEpisodes().length > 1) {
                opts.push({
                    icon: '📥',
                    label: 'Bu sezonun tum altyazilarini indir',
                    hint: seasonEpisodes().length + ' bolum',
                    value: 'season'
                });
            }

            var msg = tracks.length
                ? 'Etkin olan ✔ ile isaretlidir.'
                : 'Bu yayinda gomulu altyazi bulunamadi.\nInternetten indirmeyi deneyebilirsiniz.';

            App.UI.Modal.choose('Altyazi', opts, {
                message: msg,
                defaultIndex: defaultIndex
            }).then(function (idx) {
                if (idx === undefined) { return; }

                if (idx === 'download') { downloadSubtitleFlow(); return; }
                if (idx === 'season') { downloadSeasonFlow(); return; }
                if (idx === 'offset') { chooseOffset(); return; }
                if (idx === 'external') { return; }   /* zaten etkin */

                if (idx === -1) {
                    App.Player.setSubtitleHidden(true);
                    App.Player.rememberTrackLang('TEXT', 'off');
                    App.Subtitles.clear();
                    hideSubtitle();
                    if (subWatch.timer) { clearTimeout(subWatch.timer); subWatch.timer = null; }
                    App.UI.Toast.info('Altyazi kapatildi');
                    return;
                }

                /* Gomulu parca secildi -> indirilen altyaziyi birak */
                App.Subtitles.clear();

                var picked = null;
                for (var k = 0; k < tracks.length; k++) {
                    if (tracks[k].index === idx) { picked = tracks[k]; }
                }

                App.Player.setSubtitleHidden(false);
                App.Player.selectTrack('TEXT', idx);
                /* Bazi firmware'ler parca secimi sonrasi sessiz bayragini geri
                   aciyor; guvenlik icin tekrar kapatiyoruz. */
                App.Player.setSubtitleHidden(false);
                App.Player.rememberTrackLang('TEXT', picked && picked.language);
                hideSubtitle();
                watchSubtitleArrival();
                App.UI.Toast.success('Altyazi: ' +
                    langName(picked && picked.language, 'acildi') +
                    '  (sonraki bolumlerde de kullanilacak)');
            });
        }

        /* ================= Internetten altyazi ================= */

        /** Baglamdaki bolumlerden dizi adini bul (kayitta eksikse) */
        function seriesTitleFromContext() {
            var ctx = App.Player.getContext();
            for (var i = 0; i < ctx.items.length; i++) {
                if (ctx.items[i] && ctx.items[i].seriesName) { return ctx.items[i].seriesName; }
            }
            return '';
        }

        function downloadSubtitleFlow() {
            var item = App.Player.getItem();

            if (!App.OpenSubtitles.isConfigured()) {
                App.UI.Modal.alert('Altyazi servisi ayarlanmamis',
                    'Bu ozellik UCRETSIZDIR; yalnizca BIR DEFALIK bir API anahtari\n' +
                    'girmeniz gerekir. Servis (OpenSubtitles) anahtarsiz istek kabul\n' +
                    'etmiyor ve kota anahtarin sahibine yazildigi icin anahtar\n' +
                    'uygulamaya gomulemez.\n\n' +
                    'Nasil alinir (~3 dakika):\n' +
                    '1. opensubtitles.com adresinde ucretsiz hesap acin\n' +
                    '2. Hesabim > API Consumers > New Consumer\n' +
                    '3. Cikan API Key\'i Ayarlar > Altyazi Servisi ekranina yapistirin\n\n' +
                    'Kullanici adi ve sifre ZORUNLU DEGILDIR (girerseniz kota artar).');
                return;
            }

            /* Ogede dizi adi yoksa oynatma baglamindaki (ayni dizinin
               diger bolumleri) kayitlardan tamamla. */
            var q = App.OpenSubtitles.queryFor(item, seriesTitleFromContext());

            if (!q) {
                App.UI.Toast.warn('Bu icerik icin arama yapilamiyor');
                return;
            }
            if (!q.query) {
                App.UI.Modal.alert('Dizi adi bulunamadi',
                    'Bu bolum kaydinda yalnizca bolum etiketi var ' +
                    '("' + U.truncate(item.name, 40) + '"), dizi adi yok.\n\n' +
                    'Bolumu Diziler bolumunden acarsaniz dizi adi da tasinir ve\n' +
                    'altyazi aramasi calisir.');
                return;
            }

            var label = q.query + (q.season ? ('  S' + U.pad2(q.season) + 'B' + U.pad2(q.episode)) : '');

            /* ONBELLEK: daha once indirildiyse internete hic cikma */
            App.SubtitleCache.get(item).then(function (cached) {
                if (cached && cached.text) {
                    App.UI.Modal.choose('Bu bolumun altyazisi cihazda kayitli', [
                        { icon: '💾', label: 'Kayitli altyaziyi kullan',
                          hint: 'HAK HARCAMAZ', value: 'cache' },
                        { icon: '🌐', label: 'Yeniden indir (bozuksa)',
                          hint: '1 hak', value: 'fresh' }
                    ], { message: cached.name ? U.truncate(cached.name, 60) : label })
                        .then(function (c) {
                            if (c === 'cache') { loadFromCache(item, cached); }
                            else if (c === 'fresh') { runSearch(q, label, item); }
                        });
                    return;
                }
                runSearch(q, label, item);
            });
        }

        function loadFromCache(item, rec) {
            try {
                var n = App.Subtitles.load(rec.text, { name: rec.name, language: rec.language });
                App.Player.setSubtitleHidden(true);
                hideSubtitle();
                renderExternalSubtitle(App.Player.getPosition());
                App.UI.Toast.success('Kayitli altyazi yuklendi (' + n + ' satir)');
            } catch (e) {
                App.SubtitleCache.remove(item);
                App.UI.Toast.error('Kayitli altyazi bozuk, silindi. Yeniden indirin.');
            }
        }

        function runSearch(q, label, item) {
            App.UI.Loading.show('Altyazi araniyor: ' + label, { delay: 0 });

            App.OpenSubtitles.search(q).then(function (list) {
                App.UI.Loading.hide(true);

                if (!list.length) {
                    App.UI.Modal.alert('Altyazi bulunamadi',
                        '"' + label + '" icin sonuc yok.\n\n' +
                        'Kaynaktaki icerik adi arama icin uygun olmayabilir\n' +
                        've dil secimi Ayarlar > Altyazi Servisi bolumundendir.');
                    return;
                }

                var opts = [];
                for (var i = 0; i < list.length; i++) {
                    var r = list[i];
                    var tags = [];
                    if (r.fromTrusted) { tags.push('guvenilir'); }
                    if (r.aiTranslated || r.machineTranslated) { tags.push('makine cevirisi'); }
                    if (r.hearingImpaired) { tags.push('isitme engelli'); }
                    opts.push({
                        icon: r.fromTrusted ? '⭐' : '💬',
                        label: U.truncate(r.release || r.fileName, 58) +
                               (tags.length ? ('   [' + tags.join(', ') + ']') : ''),
                        hint: r.downloads ? (r.downloads + '↓') : '',
                        value: r.fileId
                    });
                }

                App.UI.Modal.choose('Altyazi Sec  (' + list.length + ' sonuc)', opts, {
                    message: label + '  •  dil: ' +
                             (App.Settings.get('subtitleSearchLang') || 'tr').toUpperCase()
                }).then(function (fileId) {
                    if (fileId === undefined) { return; }
                    applyDownloaded(fileId, list);
                });
            }, function (err) {
                App.UI.Loading.hide(true);
                var e = App.AppError.wrap(err);
                App.UI.Modal.alert('Altyazi aranamadi',
                    e.message + (e.detail ? '\n\n(' + e.detail + ')' : ''));
            });
        }

        function applyDownloaded(fileId, list) {
            App.UI.Loading.show('Altyazi indiriliyor...', { delay: 0 });

            App.OpenSubtitles.download(fileId).then(function (res) {
                App.UI.Loading.hide(true);

                var picked = null;
                for (var i = 0; i < list.length; i++) {
                    if (list[i].fileId === fileId) { picked = list[i]; }
                }

                var n = App.Subtitles.load(res.text, {
                    name: (picked && picked.release) || res.fileName,
                    language: picked && picked.language
                });

                /* Cihaza kaydet: ayni bolum tekrar acildiginda hak harcanmasin */
                App.SubtitleCache.put(App.Player.getItem(), picked && picked.language, {
                    text: res.text,
                    name: (picked && picked.release) || res.fileName,
                    language: picked && picked.language
                });

                /* Gomulu altyazi kapatilir; artik biz ciziyoruz */
                App.Player.setSubtitleHidden(true);
                hideSubtitle();

                var extra = (res.remaining !== null && res.remaining !== undefined)
                    ? ('  •  bugun kalan indirme hakki: ' + res.remaining) : '';
                App.UI.Toast.success('Altyazi yuklendi (' + n + ' satir)' + extra, 6000);

                if (App.Player.getState() === App.Player.STATE.PLAYING) {
                    renderExternalSubtitle(App.Player.getPosition());
                }
            }, function (err) {
                App.UI.Loading.hide(true);
                var e = App.AppError.wrap(err);
                App.UI.Modal.alert('Altyazi indirilemedi',
                    e.message + (e.detail ? '\n\n(' + e.detail + ')' : ''));
            });
        }

        /* ================= Sezonun tamamini indir ================= */

        /** Oynatma baglamindaki AYNI SEZONA ait bolumler */
        function seasonEpisodes() {
            var cur = App.Player.getItem();
            if (!cur || cur.type !== 'episode') { return []; }
            var ctx = App.Player.getContext();
            var out = [];
            for (var i = 0; i < ctx.items.length; i++) {
                var it = ctx.items[i];
                if (it && it.type === 'episode' &&
                    U.toInt(it.season, 0) === U.toInt(cur.season, 0)) {
                    out.push(it);
                }
            }
            return out;
        }

        function downloadSeasonFlow() {
            if (!App.OpenSubtitles.isConfigured()) { downloadSubtitleFlow(); return; }

            var eps = seasonEpisodes();
            if (!eps.length) { App.UI.Toast.warn('Sezon bolumleri bulunamadi'); return; }

            var lang = App.Settings.get('subtitleSearchLang') || 'tr';

            /* Zaten kayitli olanlari say: onlar icin hak harcanmayacak */
            var checks = [];
            for (var i = 0; i < eps.length; i++) { checks.push(App.SubtitleCache.has(eps[i], lang)); }

            Promise.all(checks).then(function (flags) {
                var todo = [];
                for (var j = 0; j < eps.length; j++) {
                    if (!flags[j]) { todo.push(eps[j]); }
                }
                var already = eps.length - todo.length;

                if (!todo.length) {
                    App.UI.Modal.alert('Zaten indirilmis',
                        'Bu sezondaki ' + eps.length + ' bolumun altyazisi cihazda kayitli.\n' +
                        'Bolumu actiginizda otomatik yuklenir.');
                    return;
                }

                App.UI.Modal.confirm('Sezonun altyazilari indirilsin mi?',
                    'Toplam ' + eps.length + ' bolum' +
                    (already ? (', ' + already + ' tanesi zaten kayitli') : '') + '.\n' +
                    'Indirilecek: ' + todo.length + ' bolum.\n\n' +
                    'DIKKAT: OpenSubtitles gunluk hakki DOSYA BASINA sayilir;\n' +
                    'bu islem ' + todo.length + ' hak harcar. Kazanc sudur:\n' +
                    'indirilenler cihazda saklanir, ayni bolumu tekrar\n' +
                    'actiginizda bir daha hak harcanmaz.\n\n' +
                    'RETURN tusuyla islemi durdurabilirsiniz.',
                    { okText: 'Indir' })
                    .then(function (yes) {
                        if (yes) { runBatch(todo, lang); }
                    });
            });
        }

        function runBatch(todo, lang) {
            batch.running = true;
            batch.cancel = false;

            var ok = 0, miss = 0, i = 0;
            var stopReason = '';

            App.UI.Loading.show('Sezon altyazilari indiriliyor...', { delay: 0 });

            function step() {
                if (destroyed) { finish(); return; }
                if (batch.cancel) { stopReason = 'Islem durduruldu.'; finish(); return; }
                if (i >= todo.length) { finish(); return; }

                var ep = todo[i++];
                App.UI.Loading.setProgress(
                    i + ' / ' + todo.length + '   •   S' + U.pad2(ep.season) + 'B' + U.pad2(ep.episodeNum) +
                    '   •   bulunan: ' + ok);

                var q = App.OpenSubtitles.queryFor(ep, seriesTitleFromContext());
                if (!q || !q.query) { miss++; return step(); }

                /* ONEMLI: .then(basarili, hatali) bicimi, "basarili"
                   icindeki indirme hatasini YAKALAMAZ; o durumda dongu
                   sessizce durur ve "Yukleniyor" ekranda kalirdi.
                   Bu yuzden tek bir .catch() ile bitiriyoruz. */
                App.OpenSubtitles.search(q).then(function (list) {
                    if (!list.length) { miss++; return null; }

                    return App.OpenSubtitles.download(list[0].fileId).then(function (res) {
                        return App.SubtitleCache.put(ep, list[0].language, {
                            text: res.text,
                            name: list[0].release || res.fileName,
                            language: list[0].language
                        }).then(function () {
                            ok++;
                            return res;
                        });
                    });
                }).then(function (res) {
                    /* Kota bittiyse devam etmenin anlami yok */
                    if (res && res.remaining !== null && res.remaining !== undefined &&
                        res.remaining <= 0) {
                        stopReason = 'Gunluk indirme hakkiniz bitti.';
                        finish();
                        return;
                    }
                    step();
                })['catch'](function (err) {
                    var e = App.AppError.wrap(err);
                    if (/kota|quota|limit/i.test(String(e.detail || '') + ' ' + String(e.message || ''))) {
                        stopReason = 'Gunluk indirme hakkiniz bitti.';
                        finish();
                        return;
                    }
                    miss++;
                    step();
                });
            }

            function finish() {
                if (!batch.running) { return; }
                batch.running = false;
                App.UI.Loading.hide(true);
                if (destroyed) { return; }

                App.UI.Modal.alert('Sezon altyazilari',
                    (stopReason ? (stopReason + '\n\n') : '') +
                    'Indirilen: ' + ok + '\n' +
                    'Bulunamayan: ' + miss + '\n\n' +
                    'Kayitli altyazilar bolumu actiginizda otomatik yuklenir.');

                /* Su an oynayan bolume aitse hemen uygula */
                autoLoadCachedSubtitle(App.Player.getItem());
            }

            step();
        }

        var OFFSETS = [-3000, -2000, -1500, -1000, -500, 0, 500, 1000, 1500, 2000, 3000];

        function chooseOffset() {
            var cur = App.Subtitles.getOffset();
            var opts = [], defaultIndex = 5;

            for (var i = 0; i < OFFSETS.length; i++) {
                var v = OFFSETS[i];
                var isCur = (v === cur);
                if (isCur) { defaultIndex = i; }
                opts.push({
                    icon: isCur ? '✔' : (v < 0 ? '⏪' : (v > 0 ? '⏩' : '⏺')),
                    label: v === 0 ? 'Kaydirma yok'
                                   : ((v > 0 ? '+' : '') + (v / 1000).toFixed(1) + ' saniye'),
                    hint: isCur ? 'ETKIN' : '',
                    current: isCur,
                    value: v
                });
            }

            App.UI.Modal.choose('Altyazi Gecikmesi', opts, {
                message: 'ARTI deger altyaziyi GECIKTIRIR, eksi deger ERKENE alir.\n' +
                         'Altyazi erken geliyorsa ARTI, gec geliyorsa EKSI secin.',
                defaultIndex: defaultIndex
            }).then(function (v) {
                if (v === undefined) { return; }
                App.Subtitles.setOffset(v);
                renderExternalSubtitle(App.Player.getPosition());
                App.UI.Toast.info('Altyazi gecikmesi: ' +
                    (v === 0 ? 'yok' : ((v > 0 ? '+' : '') + (v / 1000).toFixed(1) + ' sn')));
            });
        }

        function pushNumber(digit) {
            if (!App.Player.isLive()) { return; }
            numBuffer += String(digit);
            if (numBuffer.length > 4) { numBuffer = numBuffer.substr(-4); }
            if (!numEl) {
                numEl = U.el('div', 'numpad');
                root.appendChild(numEl);
            }
            numEl.textContent = numBuffer;
            numEl.classList.remove('hidden');

            if (numTimer) { clearTimeout(numTimer); }
            numTimer = setTimeout(function () {
                var n = U.toInt(numBuffer, -1);
                numBuffer = '';
                if (numEl) { numEl.classList.add('hidden'); }
                if (n > 0) {
                    showBuffering('Kanal ' + n + ' aciliyor...');
                    App.Player.zapToNumber(n).then(function (ok) {
                        if (ok === false) {
                            App.UI.Toast.warn(n + ' numarali kanal bulunamadi');
                            clearState();
                        }
                    });
                }
            }, 1200);
        }

        /* ================= View ================= */

        return {
            id: 'player',
            title: 'Oynatici',

            mount: function (container, params) {
                root = container;
                destroyed = false;
                returnTo = params && params.returnTo;

                root.classList.add('player');
                root.style.background = 'transparent';

                root.appendChild(buildOsd());

                stateBox = U.el('div', 'pstate hidden');
                root.appendChild(stateBox);

                buildNextUp();
                buildIntro();
                buildSubtitle();

                App.Bus.on('player:state', onState);
                App.Bus.on('player:time', onTime);
                App.Bus.on('player:item', onItem);
                App.Bus.on('player:error', onError);
                App.Bus.on('player:recovering', onRecovering);
                App.Bus.on('player:buffering', onBuffering);
                App.Bus.on('player:complete', onComplete);
                App.Bus.on('player:subtitle', onSubtitleEvt);

                /* Canli yayinda EPG'yi dakikada bir tazele */
                clockTimer = setInterval(function () {
                    if (currentItem && currentItem.type === 'live') { loadEpg(currentItem); }
                }, 60000);

                var item = params && params.item;
                if (!item) {
                    App.UI.Modal.alert('Hata', 'Oynatilacak icerik belirtilmedi.')
                        .then(function () { App.Router.back(); });
                    return;
                }

                fillItemInfo(item);
                showBuffering('Yayin aciliyor...');
                showOsd(true);

                /* ONEMLI: play() promise'i BILEREK dondurulmuyor.
                   Dondurulseydi router gecisi yayin hazir olana kadar
                   beklerdi ve yayin acilmiyorsa kullanici 30 saniye
                   boyunca RETURN tusuna basamazdi. */
                App.Player.play(item, {
                    context: params.context,
                    startMs: params.startMs,
                    resume: App.Settings.get('autoResume')
                });
            },

            onKey: function (code) {
                /* Hata ekrani acikken butonlar arasi gezinme Nav'a birakilir */
                if (errorButtons.length) {
                    if (code === KEY.LEFT || code === KEY.RIGHT ||
                        code === KEY.UP || code === KEY.DOWN || code === KEY.ENTER) {
                        return false;
                    }
                }

                if (App.Keys.isNumberKey(code)) { pushNumber(App.Keys.numberOf(code)); return true; }

                switch (code) {
                    case KEY.ENTER:
                        /* Oncelik sirasi:
                             1) Sonraki bolum onerisi acikssa -> onu baslat
                             2) Intro atlama onerisi acikssa -> introyu atla
                             3) Aksi halde DURDUR / DEVAM ET
                           (Bilgi seridini acmak icin INFO tusu kullanilir;
                            zaten her tus basiminda serit kendiliginden cikar.) */
                        if (nextUp.open) { playNext(); return true; }
                        if (intro.visible) { skipIntro(); return true; }
                        togglePause();
                        return true;

                    case KEY.INFO:
                        toggleOsd();
                        return true;

                    case KEY.UP:
                    case KEY.CH_UP:
                        if (App.Player.isLive()) { zap(-1); return true; }
                        showOsd();
                        return true;

                    case KEY.DOWN:
                    case KEY.CH_DOWN:
                        if (App.Player.isLive()) { zap(1); return true; }
                        showOsd();
                        return true;

                    case KEY.LEFT:
                        doSeek(-1);
                        return true;

                    case KEY.RIGHT:
                        doSeek(1);
                        return true;

                    /* ⏪ ⏩: 1 dakikalik adimlar. Onceden her basista ayri
                       seekTo gidiyordu; ard arda basinca AVPlay'e ust uste
                       sarma yagiyor ve goruntu donuyordu. Artik ok tuslari
                       gibi birikir ve TEK sarma yapilir. */
                    case KEY.REWIND:
                        doSeek(-1, 60);
                        return true;

                    case KEY.FF:
                        doSeek(1, 60);
                        return true;

                    case KEY.PLAY_PAUSE:
                    case KEY.PLAY:
                    case KEY.PAUSE:
                        togglePause();
                        return true;

                    case KEY.STOP:
                        App.Router.back();
                        return true;

                    case KEY.RED:
                        toggleFav();
                        return true;

                    case KEY.GREEN:
                        chooseAudioTrack();
                        return true;

                    case KEY.YELLOW:
                        chooseSubtitle();
                        return true;

                    case KEY.BLUE:
                        App.UI.Toast.info('Yayin yeniden baslatiliyor...');
                        showBuffering('Yayin yeniden baslatiliyor...');
                        App.Player.restart();
                        return true;

                    default:
                        return false;
                }
            },

            onBack: function () {
                /* Toplu indirme suruyorsa once onu durdur */
                if (batch.running) {
                    batch.cancel = true;
                    App.UI.Loading.setProgress('Durduruluyor...');
                    return true;
                }

                /* Sirasiyla: sonraki bolum onerisi -> intro onerisi -> OSD */
                if (nextUp.open) {
                    nextUp.dismissed = true;
                    hideNextUp();
                    return true;
                }
                if (intro.visible) {
                    intro.dismissed = true;
                    hideIntro();
                    return true;
                }
                if (osdVisible() && !errorButtons.length) {
                    hideOsd();
                    return true;
                }
                return false;   /* Router bir ust ekrana doner */
            },

            unmount: function () {
                destroyed = true;
                App.Bus.off('player:state', onState);
                App.Bus.off('player:time', onTime);
                App.Bus.off('player:item', onItem);
                App.Bus.off('player:error', onError);
                App.Bus.off('player:recovering', onRecovering);
                App.Bus.off('player:buffering', onBuffering);
                App.Bus.off('player:complete', onComplete);
                App.Bus.off('player:subtitle', onSubtitleEvt);

                if (osdTimer) { clearTimeout(osdTimer); }
                if (clockTimer) { clearInterval(clockTimer); }
                if (numTimer) { clearTimeout(numTimer); }
                if (seek.timer) { clearTimeout(seek.timer); }
                if (seek.hideTimer) { clearTimeout(seek.hideTimer); }
                if (subTimer) { clearTimeout(subTimer); }
                if (subWatch.timer) { clearTimeout(subWatch.timer); }

                App.Player.stop();
                App.Subtitles.clear();
                document.body.classList.remove('player-active');
                errorButtons = [];
                currentItem = null;
            }
        };
    };
})(window.App = window.App || {});
