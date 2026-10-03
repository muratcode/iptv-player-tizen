/* ============================================================
   js/app.js  -  UYGULAMA BASLATICI

   Sirasiyla:
     1. Ayarlari uygula (gunluk seviyesi vb.)
     2. Kumanda tuslarini kaydet (tizen.tvinputdevice)
     3. Ekranlari (view) router'a tanit
     4. Global tus yonlendiricisini kur
     5. Uygulama yasam dongusu olaylarini bagla
     6. Kayitli profil varsa ana ekrani, yoksa giris ekranini ac
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('App');
    var U = App.Utils;
    var KEY = App.Keys.KEY;

    var booted = false;
    var splashEl = null;          /* acilis gorseli; kaldirilinca null olur */
    var splashTimer = null;

    /* ============================================================
       ACILIS GORSELI
       Gorsel index.html icinde hazir durur (ilk boyamada gorunur).
       Uygulama ARKA PLANDA normal sekilde acilir; burada yalnizca
       gorselin ne zaman kaldirilacagi yonetilir.
       ============================================================ */
    function hideSplash(immediate) {
        if (!splashEl) { return; }
        var el = splashEl;
        splashEl = null;
        if (splashTimer) { clearTimeout(splashTimer); splashTimer = null; }

        function remove() {
            if (el.parentNode) { el.parentNode.removeChild(el); }
        }

        if (immediate) { remove(); return; }

        el.classList.add('is-hiding');
        /* Gecis bitince DOM'dan sil: cozulmus 1920x1080 goruntu
           televizyonda ~8 MB RAM tutar, geri verilmeli. */
        setTimeout(remove, 500);
    }

    function initSplash() {
        splashEl = document.getElementById('splash');
        if (!splashEl) { return; }

        var seconds = App.Settings.get('splashSeconds');
        if (seconds === undefined || seconds === null) { seconds = 2; }

        if (!seconds) { hideSplash(true); return; }

        /* Gorsel yuklenemezse siyah ekranda bekletme */
        var img = document.getElementById('splash-img');
        if (img) {
            img.onerror = function () {
                log.warn('acilis gorseli yuklenemedi: assets/splash.jpg');
                hideSplash(true);
            };
        }

        splashTimer = setTimeout(function () {
            splashTimer = null;
            hideSplash(false);
        }, seconds * 1000);

        log.info('acilis gorseli ' + seconds + ' sn gosterilecek');
    }

    /* ============================================================
       1) GLOBAL TUS YONLENDIRICISI
       Tek bir keydown dinleyicisi vardir; tus su sirayla denenir:
         a) TV klavyesi (IME) acikken -> hicbir sey yapma
         b) Modal acikken             -> Modal.onKey()
         c) Aktif view.onKey()
         d) Odakli sanal liste.onKey()
         e) Varsayilan gezinme (Nav.move / Nav.activate / Router.back)
       ============================================================ */
    function onKeyDown(e) {
        var code = e.keyCode;

        /* (0) Acilis gorseli acikken ilk tus YALNIZCA gorseli kapatir;
               arkadaki ekrana gecmez (yanlislikla bir sey secilmesin). */
        if (splashEl) {
            hideSplash(false);
            e.preventDefault();
            return;
        }

        /* (a) Metin girisi yapiliyor: tuslar TV klavyesine aittir.
               ui/field.js kendi keydown dinleyicisiyle Enter/Back'i yonetir. */
        if (App.UI.Field.isEditing()) { return; }

        /* (b) Modal her seyin onunde */
        if (App.UI.Modal.isOpen()) {
            App.UI.Modal.onKey(code);
            e.preventDefault();
            return;
        }

        /* Yukleniyor ekrani acikken yalnizca Back calissin (iptal hissi) */
        if (App.UI.Loading.isVisible() && code !== KEY.BACK && code !== KEY.EXIT) {
            e.preventDefault();
            return;
        }

        /* (c) Aktif ekran */
        var view = App.Router.currentView();
        if (view && typeof view.onKey === 'function') {
            var handled = false;
            try { handled = view.onKey(code, e) === true; }
            catch (err) { log.error('view.onKey', err && err.message); }
            if (handled) { e.preventDefault(); return; }
        }

        /* (d) Odakli sanal liste / izgara kendi gezinmesini yapar */
        var focused = App.Nav.get();
        if (focused && focused.__vlist) {
            try {
                if (focused.__vlist.onKey(code) === true) { e.preventDefault(); return; }
            } catch (err2) { log.error('vlist.onKey', err2 && err2.message); }
        }

        /* (e) Varsayilan gezinme */
        switch (code) {
            case KEY.LEFT:  App.Nav.move('left');  e.preventDefault(); break;
            case KEY.RIGHT: App.Nav.move('right'); e.preventDefault(); break;
            case KEY.UP:    App.Nav.move('up');    e.preventDefault(); break;
            case KEY.DOWN:  App.Nav.move('down');  e.preventDefault(); break;

            case KEY.ENTER:
                App.Nav.activate();
                e.preventDefault();
                break;

            case KEY.BACK:
                App.Router.back();
                e.preventDefault();
                break;

            case KEY.EXIT:
                App.Router.confirmExit();
                e.preventDefault();
                break;

            default:
                /* Islenmeyen tuslar TV'ye birakilir (ses, guc vb.) */
                break;
        }
    }

    /* ============================================================
       2) UYGULAMA YASAM DONGUSU
       ============================================================ */
    function bindLifecycle() {
        /* Uygulama arka plana alindiginda AVPlay'i durdur.
           config.xml'de background-support="disable" oldugu icin TV
           video kaynagini geri ister; durdurmazsak sonraki acilista
           "resource limit" hatasi alinir. */
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                log.info('uygulama arka planda - oynatici durduruluyor');
                try { App.Player.stop(); } catch (e) { }
            }
        });

        window.addEventListener('beforeunload', function () {
            try { App.Player.dispose(); } catch (e) { }
            try { App.Keys.unregister(); } catch (e2) { }
        });

        /* Ag durumu degisimi */
        window.addEventListener('offline', function () {
            App.UI.Toast.error('Internet baglantisi kesildi');
        });
        window.addEventListener('online', function () {
            App.UI.Toast.success('Internet baglantisi geri geldi');
        });

        /* Yakalanmamis hatalar uygulamayi COKERTMESIN */
        window.onerror = function (msg, src, line, col, err) {
            log.error('YAKALANMAMIS HATA:', msg, '@', (src || '').split('/').pop() + ':' + line);
            try { App.UI.Toast.error('Beklenmeyen bir hata olustu'); } catch (e) { }
            return true;   /* varsayilan tarayici davranisini engelle */
        };

        window.addEventListener('unhandledrejection', function (ev) {
            var e = App.AppError.wrap(ev.reason);
            log.error('ISLENMEYEN PROMISE HATASI:', e.code, e.detail);
            ev.preventDefault();
        });
    }

    /* ============================================================
       3) EKRAN KAYITLARI
       ============================================================ */
    function registerViews() {
        var names = ['login', 'playlists', 'home', 'live', 'movies', 'series', 'seriesDetail',
                     'favorites', 'recent', 'search', 'settings', 'opensubtitles', 'player'];
        for (var i = 0; i < names.length; i++) {
            var n = names[i];
            if (App.Views[n]) {
                App.Router.register(n, App.Views[n]);
            } else {
                log.error('view bulunamadi:', n);
            }
        }
        log.info(names.length + ' ekran kaydedildi');
    }

    /* ============================================================
       4) ACILIS AKISI
       ============================================================ */
    function start() {
        /* Once proje klasorundeki hesaplar.txt okunur. Dosya her build'e
           girdigi icin, Tizen yeniden kurulumda kayitli playlistleri
           silse bile hesap burada kendiliginden geri eklenir ve giris
           ekrani hic gorunmez. Dosya yoksa/bossa hicbir sey yapmaz. */
        return App.Presets.load().then(function (res) {
            var done = [];
            if (res.added) { done.push(res.added === 1 ? 'hesap eklendi' : (res.added + ' hesap eklendi')); }
            if (res.subtitles) { done.push('altyazi servisi ayarlandi'); }
            if (done.length) {
                App.UI.Toast.success('hesaplar.txt: ' + done.join(', '), 5000);
            }
            return proceed();
        });
    }

    function proceed() {
        if (!App.Profile.isLoggedIn()) {
            log.info('kayitli hesap yok -> giris ekrani');
            return App.Router.reset('login');
        }

        App.UI.Loading.show('Hazirlaniyor...', { delay: 0 });

        return App.Content.init({
            onStatus: function (t) { App.UI.Loading.setProgress(t); }
        }).then(function () {
            /* Xtream ise hesabi arka planda dogrula (bitis tarihi guncellensin).
               Basarisiz olsa bile onbellekten calismaya devam edebiliriz. */
            if (App.Content.sourceType() === 'xtream') {
                App.Xtream.login().then(function (res) {
                    App.Profile.setUserInfo(res.userInfo);
                    if (res.userInfo.daysLeft !== null && res.userInfo.daysLeft <= 3) {
                        App.UI.Toast.warn('Hesabinizin bitmesine ' +
                            res.userInfo.daysLeft + ' gun kaldi', 6000);
                    }
                }, function (err) {
                    var e = App.AppError.wrap(err);
                    log.warn('arka plan dogrulama basarisiz:', e.code);
                    if (e.code === App.ERR.AUTH || e.code === App.ERR.EXPIRED) {
                        App.UI.Modal.alert('Hesap Sorunu', e.message).then(function () {
                            App.Profile.logout();
                            App.Router.reset('login');
                        });
                    } else {
                        App.UI.Toast.warn('Sunucuya ulasilamadi, onbellekten devam ediliyor');
                    }
                });
            }

            App.UI.Loading.hide(true);
            var startView = App.Settings.get('startupView') === 'live' ? 'live' : 'home';
            return App.Router.reset(startView);

        }, function (err) {
            App.UI.Loading.hide(true);
            var e = App.AppError.wrap(err);
            log.error('acilis basarisiz', e.code, e.detail);

            App.UI.Modal.choose('Baslatilamadi', [
                { label: 'Tekrar Dene', value: 'retry', icon: '🔄' },
                { label: 'Giris Ekranina Don', value: 'login', icon: '🚪' }
            ], { message: e.message }).then(function (choice) {
                if (choice === 'retry') { start(); }
                else { App.Router.reset('login'); }
            });
        });
    }

    /* ============================================================
       5) BOOT
       ============================================================ */
    function boot() {
        if (booted) { return; }
        booted = true;

        var t0 = Date.now();
        log.info('=== IPTV Player baslatiliyor ===');

        /* Ayarlar (gunluk seviyesi dahil) */
        App.Settings.apply();

        /* Acilis gorselinin zamanlayicisini baslat (uygulama arka planda acilir) */
        initSplash();

        /* Ortam bilgisi - sorun bildiriminde cok ise yarar */
        log.info('webapis:', (window.webapis ? 'VAR' : 'YOK'),
                 '| tizen:', (window.tizen ? 'VAR' : 'YOK'),
                 '| ekran:', document.documentElement.clientWidth + 'x' +
                             document.documentElement.clientHeight);

        /* Kumanda tuslarini kaydet (medya, kanal, renk, sayi tuslari) */
        App.Keys.register();

        /* Oynatici motorunu sec (AVPlay veya HTML5) */
        App.Player.init();

        /* Router + ekranlar */
        App.Router.init(document.getElementById('app'));
        registerViews();

        /* Tus ve yasam dongusu dinleyicileri */
        document.addEventListener('keydown', onKeyDown, false);
        bindLifecycle();

        /* Modal kapaninca odak kaybolmus olabilir -> ekranin ilkine don */
        App.Bus.on('modal:close', function () {
            if (!App.Nav.get()) { App.Nav.focusFirst(); }
        });

        log.info('cekirdek hazir (' + (Date.now() - t0) + 'ms)');
        start();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(boot, 0);
    } else {
        document.addEventListener('DOMContentLoaded', boot, false);
    }

    /* Tizen bazi durumlarda DOMContentLoaded'i kacirabiliyor -> guvenlik agi */
    window.addEventListener('load', function () { setTimeout(boot, 0); }, false);

    App.boot = boot;
    App.restart = start;
    App.hideSplash = hideSplash;
})(window.App = window.App || {});
