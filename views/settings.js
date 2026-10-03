/* ============================================================
   views/settings.js
   AYARLAR
     Sol : ayar satirlari
     Sag : secili satirin aciklamasi + hesap / sistem bilgisi

   KULLANILAN TIZEN API'LERI (bilgi paneli icin)
     webapis.productinfo.getModel()        -> TV model adi
     webapis.productinfo.getFirmware()     -> firmware surumu
     webapis.productinfo.isUdPanelSupported() -> 4K panel mi
     tizen.systeminfo.getCapability(
        'http://tizen.org/feature/platform.version') -> Tizen surumu
   Hepsi try/catch icindedir; PC tarayicisinda "-" gosterilir.
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    var KEY = App.Keys.KEY;
    var log = App.Logger.get('Settings');

    App.Views = App.Views || {};

    var DISPLAY_MODES = [
        { value: 'PLAYER_DISPLAY_MODE_LETTER_BOX', label: 'Orani Koru (Letterbox)' },
        { value: 'PLAYER_DISPLAY_MODE_FULL_SCREEN', label: 'Ekrani Doldur' },
        { value: 'PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO', label: 'Otomatik' }
    ];
    var FORMATS = [
        { value: 'm3u8', label: 'HLS (.m3u8)' },
        { value: 'ts', label: 'MPEG-TS (.ts)' }
    ];
    var VOD_PLAYERS = [
        { value: 'auto', label: 'Otomatik (onerilen)' },
        { value: 'mse', label: 'Uygulama oynaticisi' }
    ];
    var OSD_TIMES = [
        { value: 4, label: '4 saniye' },
        { value: 6, label: '6 saniye' },
        { value: 10, label: '10 saniye' },
        { value: 15, label: '15 saniye' }
    ];
    var COUNTDOWNS = [
        { value: 5, label: '5 saniye' },
        { value: 10, label: '10 saniye' },
        { value: 15, label: '15 saniye' },
        { value: 20, label: '20 saniye' }
    ];
    var INTRO_LENGTHS = [
        { value: 60, label: '60 saniye' },
        { value: 90, label: '90 saniye' },
        { value: 120, label: '2 dakika' },
        { value: 150, label: '2.5 dakika' }
    ];
    var SEEK_STEPS = [
        { value: 10, label: '10 saniye' },
        { value: 15, label: '15 saniye' },
        { value: 30, label: '30 saniye' }
    ];
    var SPLASH_TIMES = [
        { value: 0, label: 'Kapali' },
        { value: 2, label: '2 saniye' },
        { value: 3, label: '3 saniye' },
        { value: 5, label: '5 saniye' },
        { value: 8, label: '8 saniye' },
        { value: 10, label: '10 saniye' }
    ];
    var LOG_LEVELS = [
        { value: 'info', label: 'Normal' },
        { value: 'debug', label: 'Ayrintili' },
        { value: 'warn', label: 'Sadece uyarilar' },
        { value: 'none', label: 'Kapali' }
    ];

    App.Views.settings = function () {
        var root, listHost, sideEl;
        var list = null;
        var rows = [];

        /* ---------------- Sistem bilgisi ---------------- */
        function systemInfo() {
            var info = {};

            try {
                if (window.webapis && webapis.productinfo) {
                    info['TV Modeli'] = webapis.productinfo.getRealModel
                        ? webapis.productinfo.getRealModel() : webapis.productinfo.getModel();
                    info['Model Kodu'] = webapis.productinfo.getModelCode();
                    info['Firmware'] = webapis.productinfo.getFirmware();
                    info['4K Panel'] = webapis.productinfo.isUdPanelSupported() ? 'Evet' : 'Hayir';
                }
            } catch (e) { log.debug('productinfo yok'); }

            try {
                if (window.tizen && tizen.systeminfo) {
                    info['Tizen Surumu'] = tizen.systeminfo.getCapability(
                        'http://tizen.org/feature/platform.version');
                }
            } catch (e2) { /* yoksay */ }

            info['Oynatici Motoru'] = App.Player.engineName() === 'avplay'
                ? 'Samsung AVPlay' : 'HTML5 video (test modu)';
            info['Ekran'] = (document.documentElement.clientWidth || 0) + ' x ' +
                            (document.documentElement.clientHeight || 0);

            var ks = App.Keys.status();
            info['Kayitli Tuslar'] = ks.registered.length + ' adet';

            var cs = App.Cache.stats();
            info['Onbellek'] = cs.disk + ' kayit  /  ' + cs.kb + ' KB';
            info['Depolama'] = App.Storage.isPersistent() ? 'Kalici (localStorage)' : 'Gecici (bellek)';
            info['Buyuk Veri Deposu'] = App.BigStore.backend();

            return info;
        }

        function accountInfo() {
            var p = App.Profile.get();
            var out = {};
            if (!p) { return out; }

            out['Kaynak Turu'] = p.type === 'xtream' ? 'Xtream Codes' : 'M3U Playlist';

            if (p.type === 'xtream') {
                out['Sunucu'] = p.host;
                out['Kullanici'] = p.username;
                var ui = App.Profile.getUserInfo();
                if (ui) {
                    out['Durum'] = ui.status;
                    out['Bitis Tarihi'] = ui.expiresText;
                    if (ui.daysLeft !== null) { out['Kalan Sure'] = ui.daysLeft + ' gun'; }
                    out['Baglanti'] = ui.activeConnections + ' / ' + ui.maxConnections;
                    if (ui.isTrial) { out['Hesap Tipi'] = 'Deneme'; }
                }
            } else {
                out['Playlist'] = U.truncate(p.m3uUrl, 60);
                if (p.epgUrl) { out['EPG'] = U.truncate(p.epgUrl, 60); }
                var st = App.Content.stats();
                if (st) {
                    out['Oge Sayisi'] = st.items;
                    out['Grup Sayisi'] = st.groups;
                }
            }

            out['Favoriler'] = App.Favorites.count() + ' oge';
            out['Gecmis'] = App.History.count() + ' kayit';

            if (App.EPG.hasIndex()) {
                var m = App.EPG.meta();
                out['EPG Verisi'] = m.channels + ' kanal / ' + m.programmes + ' program';
            }
            return out;
        }

        /* ---------------- Satirlar ---------------- */

        function buildRows() {
            var s = App.Settings.get();

            function labelOf(opts, value) {
                for (var i = 0; i < opts.length; i++) {
                    if (opts[i].value === value) { return opts[i].label; }
                }
                return String(value);
            }

            return [
                { id: 'refresh', glyph: '🔄', title: 'Icerigi Yenile',
                  desc: 'Kategori, kanal ve film listelerini sunucudan tekrar indirir.',
                  help: 'Yeni kanallar eklendiyse veya liste eksik gorunuyorsa kullanin.\n' +
                        'Onbellek temizlenir ve her sey yeniden cekilir.' },

                { id: 'epg', glyph: '📅', title: 'EPG (Program Rehberi) Yenile',
                  desc: 'XMLTV rehberini indirir.',
                  value: App.EPG.hasIndex() ? 'Yuklu' : 'Yuklu degil',
                  help: 'Dikkat: XMLTV dosyasi 10-80 MB olabilir ve indirilmesi\n' +
                        'birkac dakika surebilir. Xtream hesaplarinda kanal bazinda\n' +
                        'rehber zaten otomatik cekilir; bu secenek tum kanallarin\n' +
                        'rehberini bir kerede yukler ve listede hizli gosterir.' },

                { id: 'displayMode', glyph: '🖼', title: 'Goruntu Orani',
                  desc: 'Videonun ekrana yerlesme bicimi.',
                  value: labelOf(DISPLAY_MODES, s.displayMode),
                  help: 'Orani Koru: goruntu bozulmaz, kenarlarda siyah bant olabilir.\n' +
                        'Ekrani Doldur: goruntu gerilir, bant olmaz.\n' +
                        'AVPlay setDisplayMethod() API cagrisina karsilik gelir.' },

                { id: 'preferredFormat', glyph: '📶', title: 'Tercih Edilen Yayin Formati',
                  desc: 'Canli yayinlar icin ilk denenecek format.',
                  value: labelOf(FORMATS, s.preferredFormat),
                  help: 'HLS (.m3u8): daha uyumlu, biraz daha yuksek gecikme.\n' +
                        'MPEG-TS (.ts): daha dusuk gecikme, bazi sunucularda daha stabil.\n' +
                        'Secilen format acilmazsa uygulama otomatik digerini dener.' },

                { id: 'vodPlayer', glyph: '🎬', title: 'Film/Dizi Oynaticisi',
                  desc: 'MKV film ve dizilerde kullanilacak oynatici.',
                  value: labelOf(VOD_PLAYERS, s.vodPlayer),
                  help: 'Otomatik: Samsung oynaticisi (AVPlay). Yalnizca TV\'nin saramadigi MKV ' +
                        'dosyalarinda uygulama oynaticisi kendiliginden devreye girer.\n\n' +
                        'Uygulama oynaticisi: tum MKV film ve dizileri uygulama kendisi okur. ' +
                        'Ileri/geri sarma tam istenen saniyeye gider; 10 sn gibi kisa sarmalar ' +
                        'aninda olur.\n\n' +
                        'Canli TV ve MKV disindaki dosyalar her zaman Samsung oynaticisiyla acilir. ' +
                        'Uygulama oynaticisi bir dosyayi acamazsa o dosya Samsung oynaticisiyla acilir. ' +
                        'Degisiklik bir sonraki acilista gecerli olur.' },

                { id: 'mode4K', glyph: '🎞', title: '4K Modu',
                  desc: 'UHD yayinlar icin donanim hizlandirmasi.',
                  value: s.mode4K ? 'Acik' : 'Kapali',
                  help: 'AVPlay setStreamingProperty("SET_MODE_4K") cagrisini yapar.\n' +
                        '4K yayinlarda takilma yasarsaniz kapatmayi deneyin.' },

                { id: 'seekStep', glyph: '⏩', title: 'Ileri/Geri Sarma Adimi',
                  desc: 'Ok tusuna ilk basista atlanacak sure.',
                  value: labelOf(SEEK_STEPS, s.seekStep),
                  help: 'Ard arda bastikca adim otomatik BUYUR:\n' +
                        '  1-2. basis  -> temel adim\n' +
                        '  3-4. basis  -> 3 kat\n' +
                        '  5-7. basis  -> 6 kat\n' +
                        '  8-10. basis -> 12 kat\n' +
                        '  11+ basis   -> 30 kat (dakikalar)\n' +
                        'Basmayi birakinca tek seferde atlanir; bu, tek tek\n' +
                        'sarmaktan cok daha hizlidir.' },

                { id: 'autoNextEpisode', glyph: '⏭', title: 'Otomatik Sonraki Bolum',
                  desc: 'Bolum bitince siradakine gec.',
                  value: s.autoNextEpisode ? 'Acik' : 'Kapali',
                  help: 'Bolumun son saniyelerinde geri sayimli bir kart cikar.\n' +
                        'OK: hemen baslat, RETURN: iptal et.\n' +
                        'SEZON DEGISIYORSA otomatik gecmez, once size sorar.' },

                { id: 'nextEpisodeCountdown', glyph: '⏳', title: 'Sonraki Bolum Geri Sayimi',
                  desc: 'Kart kac saniye once ciksin.',
                  value: labelOf(COUNTDOWNS, s.nextEpisodeCountdown),
                  help: 'Bolumun bitmesine bu kadar sure kalinca "sonraki bolum"\n' +
                        'karti gorunur ve geri sayim baslar.' },

                { id: 'subtitleService', glyph: '💬', title: 'Altyazi Servisi (OpenSubtitles)',
                  desc: App.OpenSubtitles.isConfigured()
                        ? ('Yapilandirildi' + (App.OpenSubtitles.hasAccount() ? '' : ' (hesap eksik)'))
                        : 'Yapilandirilmadi',
                  help: 'Kaynaktaki altyazi bozuk, eksik veya goruntu tabanliysa\n' +
                        'oynaticidan SARI tusla internetten altyazi indirebilirsiniz.\n\n' +
                        'UCRETSIZDIR. Tek gereken BIR DEFALIK bir API anahtari:\n' +
                        'opensubtitles.com > Hesabim > API Consumers > New Consumer\n\n' +
                        'Kullanici adi/sifre ZORUNLU DEGIL - girerseniz gunluk\n' +
                        'indirme kotaniz artar.\n\n' +
                        'Anahtar uygulamaya gomulu degildir cunku kota anahtarin\n' +
                        'sahibine yazilir. Bilgiler yalnizca bu televizyonda saklanir.' },

                { id: 'showIntroSkip', glyph: '⏭', title: 'Intro Atlama Onerisi',
                  desc: 'Bolum basinda "Intro\'yu Atla" goster.',
                  value: s.showIntroSkip ? 'Acik' : 'Kapali',
                  help: 'DIKKAT: Xtream ve M3U kaynaklari intro baslangic/bitis\n' +
                        'zamani BILDIRMEZ. Bu yuzden atlama suresi tahmin degil,\n' +
                        'asagida sectiginiz SABIT deger kadardir.' },

                { id: 'introSkipSeconds', glyph: '⏱', title: 'Intro Uzunlugu',
                  desc: 'Atla denince nereye gidilecek.',
                  value: labelOf(INTRO_LENGTHS, s.introSkipSeconds),
                  help: 'Cogu dizide jenerik 60-120 saniye arasindadir.\n' +
                        'Izlediginiz diziye gore ayarlayin.' },

                { id: 'osdTimeout', glyph: '⏱', title: 'Bilgi Seridi Suresi',
                  desc: 'Oynaticida ust bilgi seridinin ekranda kalma suresi.',
                  value: labelOf(OSD_TIMES, s.osdTimeout),
                  help: 'Oynaticida OK tusuna basildiginda cikan kanal/program\n' +
                        'bilgisinin kac saniye sonra kaybolacagi.' },

                { id: 'splashSeconds', glyph: '🖼', title: 'Acilis Gorseli',
                  desc: 'Uygulama acilirken gosterilen karsilama gorseli.',
                  value: labelOf(SPLASH_TIMES, s.splashSeconds),
                  help: 'Gorsel dosyasi: assets/splash.jpg\n' +
                        'Kendi fotografinizi koymak icin bu dosyayi degistirin\n' +
                        '(1920x1080 onerilir).\n\n' +
                        'Sure dolmadan herhangi bir tusa basarak da gecebilirsiniz.' },

                { id: 'showChannelNumbers', glyph: '🔢', title: 'Kanal Numaralarini Goster',
                  desc: 'Listede kanal numarasi sutunu.',
                  value: s.showChannelNumbers ? 'Acik' : 'Kapali',
                  help: 'Kapatirsaniz kanal adlari icin daha genis alan kalir.' },

                { id: 'autoResume', glyph: '⏯', title: 'Kaldigi Yerden Devam',
                  desc: 'Film ve bolumlerde izleme konumunu hatirla.',
                  value: s.autoResume ? 'Acik' : 'Kapali',
                  help: 'Acikken film/bolum acildiginda kaldiginiz saniyeden devam eder.' },

                { id: 'logLevel', glyph: '🐞', title: 'Gunluk Ayrinti Seviyesi',
                  desc: 'Sorun giderme kayitlari.',
                  value: labelOf(LOG_LEVELS, s.logLevel),
                  help: 'Ayrintili secilirse Tizen Studio Log sekmesinde tum\n' +
                        'ag istekleri ve oynatici olaylari gorunur.' },

                { id: 'clearFav', glyph: '⭐', title: 'Favorileri Temizle',
                  desc: App.Favorites.count() + ' favori kayitli.',
                  help: 'Tum favori kanal, film ve dizileri siler. Geri alinamaz.' },

                { id: 'clearHistory', glyph: '🕒', title: 'Izleme Gecmisini Temizle',
                  desc: App.History.count() + ' kayit.',
                  help: 'Son izlenenler listesini ve kaldiginiz yer bilgilerini siler.' },

                { id: 'backup', glyph: '💾', title: 'USB\'ye Yedekle',
                  desc: 'Playlistler, favoriler ve gecmis.',
                  value: App.Backup.isAvailable() ? '' : 'Kullanilamiyor',
                  help: 'ONEMLI: Uygulamayi yeniden kurdugunuzda (yeni .wgt)\n' +
                        'Tizen kayitli verilerin TAMAMINI siler. Bu yuzden yeni\n' +
                        'bir surum yuklemeden ONCE yedek alin.\n\n' +
                        'Yedek "' + App.Backup.FILE_NAME + '" adiyla once takili USB\n' +
                        'bellege, USB yoksa TV\'nin Indirilenler klasorune yazilir.\n' +
                        'Bu klasorler uygulama kaldirilsa bile silinmez.\n\n' +
                        '⚠ Yedek dosyasi sifrelerinizi duz metin icerir.' },

                { id: 'restore', glyph: '📥', title: 'Yedekten Geri Yukle',
                  desc: App.Backup.FILE_NAME + ' dosyasindan.',
                  value: App.Backup.isAvailable() ? '' : 'Kullanilamiyor',
                  help: 'USB bellekte veya Indirilenler klasorunde bulunan yedek\n' +
                        'dosyasini okur. Zaten kayitli olan playlistler tekrar\n' +
                        'eklenmez; yalnizca eksikler tamamlanir.' },

                { id: 'clearSubs', glyph: '💬', title: 'Altyazi Onbellegini Temizle',
                  desc: (function () {
                      var st = App.SubtitleCache.stats();
                      return st.count ? (st.count + ' altyazi, ' + st.kb + ' KB') : 'Kayitli altyazi yok';
                  })(),
                  help: 'Internetten indirilen altyazilar cihazda saklanir; ayni bolumu\n' +
                        'tekrar actiginizda YENIDEN INDIRILMEZ ve OpenSubtitles gunluk\n' +
                        'hakkiniz harcanmaz.\n\n' +
                        'Bir altyazi bozuksa oynaticida SARI tus > "Yeniden indir"\n' +
                        'diyebilirsiniz; buradan ise tumunu birden silersiniz.' },

                { id: 'clearCache', glyph: '🧹', title: 'Onbellegi Temizle',
                  desc: App.Cache.stats().kb + ' KB kullaniliyor.',
                  help: 'Indirilen kanal/film listelerini siler. Hesap bilgileri ve\n' +
                        'favoriler KORUNUR. Uygulama yavaslarsa veya liste guncel\n' +
                        'degilse kullanin.' },

                { id: 'playlists', glyph: '📄', title: 'Kayitli Playlistler',
                  desc: App.Profiles.count() + ' playlist kayitli.',
                  help: 'Birden fazla Xtream hesabi veya M3U listesi kaydedip\n' +
                        'aralarinda tek tusla gecis yapabilirsiniz.\n' +
                        'Her playlist icin telefona aktarim QR kodu da bu ekranda.' },

                { id: 'logout', glyph: '🚪', title: 'Aktif Hesaptan Cik',
                  desc: 'Giris ekranina don.',
                  help: 'Yalnizca AKTIF secim kaldirilir; kayitli playlistleriniz\n' +
                        'SILINMEZ. Favoriler ve izleme gecmisi de korunur.\n' +
                        'Playlistleri silmek icin "Kayitli Playlistler" ekranini kullanin.' },

                { id: 'wipe', glyph: '⚠', title: 'Uygulama Verilerini Sifirla',
                  desc: 'Her seyi fabrika ayarlarina dondur.',
                  help: 'Hesap bilgileri, favoriler, gecmis, ayarlar ve onbellek\n' +
                        'dahil TUM veriler silinir. Bu islem geri alinamaz.' },

                { id: 'about', glyph: 'ℹ', title: 'Sistem Bilgisi',
                  desc: 'TV modeli, Tizen surumu, oynatici motoru.',
                  help: 'Sag panelde teknik bilgiler gosterilir.\n' +
                        'Destek isterken bu bilgileri paylasin.' }
            ];
        }

        function renderRow(node, item) {
            U.empty(node);
            node.className = 'srow';
            /* .srow CSS'inde position yok (normal akista da kullaniliyor);
               sanal listede mutlak konumlandirma gerektigi icin burada veriyoruz.
               Satir yuksegi 5.25rem, satir araligi 5.75rem -> 0.5rem bosluk. */
            node.style.position = 'absolute';
            node.style.left = '0';
            node.style.right = '0';
            node.style.marginBottom = '0';
            node.style.height = U.rem(5.25) + 'px';

            node.appendChild(U.el('div', 'srow__glyph', item.glyph));

            var t = U.el('div', 'srow__text');
            t.appendChild(U.el('div', 'srow__title', item.title));
            t.appendChild(U.el('div', 'srow__desc ellipsis', item.desc || ''));
            node.appendChild(t);

            if (item.value !== undefined) {
                node.appendChild(U.el('div', 'srow__value', item.value));
            }
        }

        /* ---------------- Sag panel ---------------- */

        function showSide(item) {
            U.empty(sideEl);
            if (!item) { return; }

            sideEl.appendChild(U.el('div', 'col__head', item.title));
            if (item.help) {
                sideEl.appendChild(U.el('div', 'settings__help', item.help));
            }

            var data = (item.id === 'about') ? systemInfo() : accountInfo();
            var title = (item.id === 'about') ? 'SISTEM' : 'HESAP';
            sideEl.appendChild(U.el('div', 'side__sec', title));

            for (var k in data) {
                if (!Object.prototype.hasOwnProperty.call(data, k)) { continue; }
                var row = U.el('div', 'info-row');
                row.appendChild(U.el('span', 'info-row__k', k));
                row.appendChild(U.el('span', 'info-row__v', String(data[k])));
                sideEl.appendChild(row);
            }
        }

        function refreshRows(keepIndex) {
            var idx = keepIndex ? list.getIndex() : 0;
            rows = buildRows();
            /* keepScroll: bir ayari degistirince liste yerinde kalsin
               (onceden her OK'ta odakli satir ortaya zipliyordu) */
            list.setItems(rows, { index: idx, silent: true, keepScroll: !!keepIndex });
            showSide(rows[idx]);
        }

        /* ---------------- Eylemler ---------------- */

        function activate(item) {
            switch (item.id) {

                case 'refresh':
                    App.UI.Loading.show('Icerik yenileniyor...', { delay: 0 });
                    App.Content.refresh(function (t) { App.UI.Loading.setProgress(t); })
                        .then(function () {
                            App.UI.Loading.hide(true);
                            App.UI.Toast.success('Icerik yenilendi');
                            refreshRows(true);
                        }, function (err) {
                            App.UI.Loading.hide(true);
                            App.UI.Modal.alert('Yenilenemedi', App.AppError.wrap(err).message);
                        });
                    return;

                case 'epg':
                    loadEpg();
                    return;

                case 'displayMode':
                    var dm = App.Settings.cycle('displayMode', DISPLAY_MODES);
                    App.Player.setDisplayMode(dm.value);
                    App.UI.Toast.info('Goruntu orani: ' + dm.label);
                    refreshRows(true);
                    return;

                case 'preferredFormat':
                    var fm = App.Settings.cycle('preferredFormat', FORMATS);
                    App.UI.Toast.info('Yayin formati: ' + fm.label);
                    refreshRows(true);
                    return;

                case 'vodPlayer':
                    var vp = App.Settings.cycle('vodPlayer', VOD_PLAYERS);
                    App.UI.Toast.info('Film/dizi oynaticisi: ' + vp.label);
                    refreshRows(true);
                    return;

                case 'osdTimeout':
                    var ot = App.Settings.cycle('osdTimeout', OSD_TIMES);
                    App.UI.Toast.info('Bilgi seridi: ' + ot.label);
                    refreshRows(true);
                    return;

                case 'logLevel':
                    var lv = App.Settings.cycle('logLevel', LOG_LEVELS);
                    App.UI.Toast.info('Gunluk: ' + lv.label);
                    refreshRows(true);
                    return;

                case 'nextEpisodeCountdown':
                    var nc = App.Settings.cycle('nextEpisodeCountdown', COUNTDOWNS);
                    App.UI.Toast.info('Geri sayim: ' + nc.label);
                    refreshRows(true);
                    return;

                case 'introSkipSeconds':
                    var il = App.Settings.cycle('introSkipSeconds', INTRO_LENGTHS);
                    App.UI.Toast.info('Intro uzunlugu: ' + il.label);
                    refreshRows(true);
                    return;

                case 'splashSeconds':
                    var sp = App.Settings.cycle('splashSeconds', SPLASH_TIMES);
                    App.UI.Toast.info('Acilis gorseli: ' + sp.label);
                    refreshRows(true);
                    return;

                case 'seekStep':
                    var ss = App.Settings.cycle('seekStep', SEEK_STEPS);
                    App.UI.Toast.info('Sarma adimi: ' + ss.label);
                    refreshRows(true);
                    return;

                case 'subtitleService':
                    App.Router.go('opensubtitles');
                    return;

                case 'backup':
                    doBackup();
                    return;

                case 'restore':
                    doRestore();
                    return;

                case 'mode4K':
                case 'showChannelNumbers':
                case 'autoResume':
                case 'autoNextEpisode':
                case 'showIntroSkip':
                    var on = App.Settings.toggle(item.id);
                    App.UI.Toast.info(item.title + ': ' + (on ? 'Acik' : 'Kapali'));
                    refreshRows(true);
                    return;

                case 'clearFav':
                    App.UI.Modal.confirm('Favoriler silinsin mi?',
                        App.Favorites.count() + ' kayit silinecek. Bu islem geri alinamaz.',
                        { danger: true, okText: 'Sil' })
                        .then(function (yes) {
                            if (!yes) { return; }
                            App.Favorites.clear();
                            App.UI.Toast.success('Favoriler temizlendi');
                            refreshRows(true);
                        });
                    return;

                case 'clearHistory':
                    App.UI.Modal.confirm('Izleme gecmisi silinsin mi?',
                        'Kaldiginiz yer bilgileri de silinecek.',
                        { danger: true, okText: 'Sil' })
                        .then(function (yes) {
                            if (!yes) { return; }
                            App.History.clear();
                            App.UI.Toast.success('Gecmis temizlendi');
                            refreshRows(true);
                        });
                    return;

                case 'clearSubs':
                    var subSt = App.SubtitleCache.stats();
                    if (!subSt.count) {
                        App.UI.Toast.info('Kayitli altyazi yok');
                        return;
                    }
                    App.UI.Modal.confirm('Altyazi onbellegi silinsin mi?',
                        subSt.count + ' altyazi (' + subSt.kb + ' KB) silinecek.\n' +
                        'Tekrar ihtiyac duyarsaniz yeniden indirmeniz gerekir\n' +
                        've bu gunluk hakkinizdan dusulur.',
                        { danger: true, okText: 'Sil' })
                        .then(function (yes) {
                            if (!yes) { return; }
                            App.SubtitleCache.clear().then(function () {
                                App.UI.Toast.success('Altyazi onbellegi temizlendi');
                                refreshRows(true);
                            });
                        });
                    return;

                case 'clearCache':
                    App.UI.Modal.confirm('Onbellek temizlensin mi?',
                        'Kanal ve film listeleri bir sonraki aciliste yeniden indirilir.\n' +
                        'Hesap bilgileriniz ve favorileriniz KORUNUR.',
                        { okText: 'Temizle' })
                        .then(function (yes) {
                            if (!yes) { return; }
                            var n = App.Cache.clear();
                            App.EPG.clear();
                            App.BigStore.clear();     /* buyuk playlist deposu */
                            App.UI.Toast.success(n + ' onbellek kaydi silindi');
                            refreshRows(true);
                        });
                    return;

                case 'logout':
                    App.UI.Modal.confirm('Aktif hesaptan cikilsin mi?',
                        'Kayitli playlistleriniz SILINMEZ, yalnizca aktif secim kaldirilir.\n' +
                        'Favorileriniz ve gecmisiniz korunur.',
                        { danger: true, okText: 'Cikis Yap' })
                        .then(function (yes) {
                            if (!yes) { return; }
                            App.Profile.logout();
                            App.EPG.clear();
                            App.UI.Toast.info('Cikis yapildi');
                            App.Router.reset('login');
                        });
                    return;

                case 'wipe':
                    App.UI.Modal.confirm('TUM VERILER SILINSIN MI?',
                        'Hesap bilgileri, favoriler, izleme gecmisi, ayarlar ve\n' +
                        'onbellek dahil her sey silinecek.\n\nBu islem GERI ALINAMAZ.',
                        { danger: true, okText: 'Hepsini Sil', defaultIndex: 1 })
                        .then(function (yes) {
                            if (!yes) { return; }
                            App.Profile.wipe();
                            App.Favorites.invalidate();
                            App.History.invalidate();
                            App.Settings.reset();
                            App.EPG.clear();
                            App.UI.Toast.success('Uygulama sifirlandi');
                            App.Router.reset('login');
                        });
                    return;

                case 'playlists':
                    App.Router.go('playlists');
                    return;

                case 'about':
                    showSide(item);
                    return;
            }
        }

        /* ---------------- Yedekleme ---------------- */

        function doBackup() {
            if (!App.Backup.isAvailable()) {
                App.UI.Modal.alert('Yedekleme kullanilamiyor',
                    'Bu ozellik yalnizca televizyonda calisir (tizen.filesystem).\n' +
                    'PC tarayicisinda test ediyorsaniz beklenen bir durumdur.');
                return;
            }

            App.UI.Modal.confirm('Yedek alinsin mi?',
                'Kayitli playlistler, favoriler, izleme gecmisi ve ayarlar\n' +
                '"' + App.Backup.FILE_NAME + '" dosyasina yazilacak.\n\n' +
                'Once takili USB bellege, USB yoksa Indirilenler klasorune.\n\n' +
                '⚠ Dosya sifrelerinizi duz metin icerir.',
                { okText: 'Yedekle' })
                .then(function (yes) {
                    if (!yes) { return; }
                    App.UI.Loading.show('Yedek yaziliyor...', { delay: 0 });
                    App.Backup.save().then(function (res) {
                        App.UI.Loading.hide(true);
                        App.UI.Modal.alert('Yedek alindi',
                            'Konum: ' + res.label + '\n' +
                            'Dosya: ' + App.Backup.FILE_NAME + '\n' +
                            'Boyut: ' + Math.round(res.bytes / 1024) + ' KB');
                        refreshRows(true);
                    }, function (err) {
                        App.UI.Loading.hide(true);
                        var e = App.AppError.wrap(err);
                        App.UI.Modal.alert('Yedek alinamadi',
                            e.message + '\n\n' +
                            'USB bellek takili mi? Bazi TV modellerinde yazma\n' +
                            'yalnizca USB bellege izinlidir.' +
                            (e.detail ? '\n\n(' + e.detail + ')' : ''));
                    });
                });
        }

        function doRestore() {
            if (!App.Backup.isAvailable()) {
                App.UI.Modal.alert('Geri yukleme kullanilamiyor',
                    'Bu ozellik yalnizca televizyonda calisir (tizen.filesystem).');
                return;
            }

            App.UI.Modal.confirm('Yedekten geri yuklensin mi?',
                'USB bellekte veya Indirilenler klasorunde bulunan\n' +
                '"' + App.Backup.FILE_NAME + '" dosyasi okunacak.\n\n' +
                'Zaten kayitli playlistler TEKRAR EKLENMEZ.',
                { okText: 'Geri Yukle' })
                .then(function (yes) {
                    if (!yes) { return; }
                    App.UI.Loading.show('Yedek okunuyor...', { delay: 0 });
                    App.Backup.restore().then(function (sum) {
                        App.UI.Loading.hide(true);
                        App.UI.Modal.alert('Geri yukleme tamamlandi',
                            'Kaynak: ' + sum.label + '\n' +
                            (sum.createdAt ? ('Yedek tarihi: ' + U.ddmmyyyy(new Date(sum.createdAt)) + '\n') : '') +
                            '\n' +
                            'Eklenen playlist: ' + sum.profiles + '\n' +
                            'Eklenen favori: ' + sum.favorites + '\n' +
                            'Gecmis kaydi: ' + sum.history);
                        refreshRows(true);
                    }, function (err) {
                        App.UI.Loading.hide(true);
                        var e = App.AppError.wrap(err);
                        App.UI.Modal.alert('Geri yuklenemedi',
                            e.message + (e.detail ? '\n\n(' + e.detail + ')' : ''));
                    });
                });
        }

        function loadEpg() {
            var url = App.Content.epgUrl();
            if (!url) {
                App.UI.Modal.alert('EPG adresi yok',
                    'Bu kaynak icin bir XMLTV rehber adresi bulunamadi.\n' +
                    'M3U kullaniyorsaniz giris ekranindan EPG adresini girebilirsiniz.');
                return;
            }

            App.UI.Modal.confirm('EPG indirilsin mi?',
                'XMLTV dosyasi buyuk olabilir (10-80 MB) ve indirilmesi\n' +
                'birkac dakika surebilir. Devam edilsin mi?',
                { okText: 'Indir' })
                .then(function (yes) {
                    if (!yes) { return; }
                    App.UI.Loading.show('EPG hazirlaniyor...', { delay: 0 });

                    App.Content.allEpgChannelIds().then(function (ids) {
                        return App.EPG.loadXmltv(url, {
                            channelIds: ids,
                            onStatus: function (t) { App.UI.Loading.setProgress(t); }
                        });
                    }).then(function (meta) {
                        App.UI.Loading.hide(true);
                        App.UI.Toast.success('EPG yuklendi: ' + meta.channels + ' kanal, ' +
                                             meta.programmes + ' program');
                        refreshRows(true);
                    }, function (err) {
                        App.UI.Loading.hide(true);
                        var e = App.AppError.wrap(err);
                        App.UI.Modal.alert('EPG yuklenemedi',
                            e.message + (e.detail ? '\n\n(' + e.detail + ')' : ''));
                    });
                });
        }

        return {
            id: 'settings',
            title: 'Ayarlar',

            mount: function (container) {
                root = container;

                var bar = U.el('div', 'topbar');
                bar.appendChild(U.el('div', 'topbar__title', '⚙ Ayarlar'));
                bar.appendChild(U.el('div', 'topbar__spacer'));
                root.appendChild(bar);

                var body = U.el('div', 'body');
                var wrap = U.el('div', 'settings');

                listHost = U.el('div', 'settings__list');
                wrap.appendChild(listHost);

                sideEl = U.el('div', 'settings__side');
                wrap.appendChild(sideEl);

                body.appendChild(wrap);
                root.appendChild(body);

                var hints = U.el('div', 'hintbar');
                hints.innerHTML =
                    '<span class="hint"><span class="hint__key">OK</span> Sec / Degistir</span>' +
                    '<span class="hint"><span class="hint__key">RETURN</span> Geri</span>';
                root.appendChild(hints);

                list = App.UI.VirtualList.create({
                    container: listHost,
                    itemHeight: U.rem(5.75),
                    gapY: 0,
                    itemClass: 'srow',
                    render: renderRow,
                    onFocusChange: showSide,
                    onSelect: activate
                });

                App.Nav.bind(listHost, function () { list.select(); }, {
                    onFocus: function () { list.setActive(true); },
                    onBlur: function () { list.setActive(false); },
                    isDefault: true
                });

                rows = buildRows();
                list.setItems(rows);
                showSide(rows[0]);
                App.Nav.focus(listHost);
                list.setActive(true);
            },

            onResume: function () { refreshRows(true); },

            onKey: function () { return false; },

            unmount: function () {
                if (list) { list.destroy(); }
                list = null;
            }
        };
    };
})(window.App = window.App || {});
