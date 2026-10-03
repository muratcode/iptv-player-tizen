/* ============================================================
   js/core/router.js
   Ekran (view) yonetimi + GERI (Back) tusu davranisi.

   BACK DAVRANISI (istenen davranis):
     oynatici  -> liste
     liste     -> ana menu
     ana menu  -> "Cikmak istiyor musunuz?" onayi -> uygulamadan cikis
   Bu, bir VIEW YIGINI (stack) ile saglanir. Back her zaman yiginin
   en ustundeki ekrani atar; yigin tek elemana dustugunde onay sorar.

   VIEW ARAYUZU (her views/*.js bunu doner):
     {
       id: 'live',
       title: 'Canli TV',
       mount(container, params)   -> void | Promise
       unmount()                  -> void          (opsiyonel)
       onPause()                  -> void          (ustune yeni view geldi)
       onResume(params)           -> void          (ustteki view kapandi)
       onKey(keyCode, event)      -> true ise olay tuketildi (opsiyonel)
       onBack()                   -> true ise geri gitmeyi VIEW halletti
     }
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('Router');
    var U = App.Utils;

    var views = {};               /* id -> view factory/nesnesi */
    var stack = [];               /* [{id, params, view, el}] */
    var container = null;
    var transitioning = false;

    function makeViewEl(id) {
        var el = U.el('div', 'view');
        el.setAttribute('data-view', id);
        return el;
    }

    function top() { return stack.length ? stack[stack.length - 1] : null; }

    function activate(entry) {
        /* Diger tum view'lari pasiflestir */
        for (var i = 0; i < stack.length; i++) {
            var isTop = (stack[i] === entry);
            U.toggleClass(stack[i].el, 'is-active', isTop);
        }
        App.Nav.setScope(entry.el);

        /* ODAK KURTARMA:
           Bir alt ekrandan geri donuldugunde odakli oge o ekranla birlikte
           silinmis olur ve hicbir sey secili kalmaz -> kullanici yon tusuna
           bassa bile nereye gidecegini goremez. Odak bu ekranin disindaysa
           (veya hic yoksa) ilk odaklanabilir ogeye geri aliriz.
           mount() kendi odagini ayarladiysa ona dokunulmaz. */
        var f = App.Nav.get();
        if (!f || !entry.el.contains(f)) {
            App.Nav.focusFirst(entry.el);
        }

        App.Bus.emit('router:change', { id: entry.id, depth: stack.length });
    }

    function destroyEntry(entry) {
        try {
            if (entry.view && typeof entry.view.unmount === 'function') { entry.view.unmount(); }
        } catch (e) {
            log.error('unmount hatasi', entry.id, e && e.message);
        }
        App.Nav.releaseIfInside(entry.el);
        if (entry.el && entry.el.parentNode) { entry.el.parentNode.removeChild(entry.el); }
    }

    /**
     * View'i olustur + mount et.
     * mount bir Promise dondurebilir (veri yukleme).
     */
    function mountEntry(id, params) {
        var factory = views[id];
        if (!factory) {
            log.error('bilinmeyen view:', id);
            return Promise.reject(new App.AppError(App.ERR.NOT_FOUND, 'view ' + id));
        }

        var view = (typeof factory === 'function') ? factory() : factory;
        var el = makeViewEl(id);
        container.appendChild(el);
        /* ONEMLI: mount() sirasinda el GORUNUR olmalidir.
           display:none iken clientWidth/clientHeight = 0 doner ve
           sanal liste/izgara satir yuksekligini hesaplayamaz. */
        el.classList.add('is-active');

        var entry = { id: id, params: params || {}, view: view, el: el };

        return Promise.resolve()
            .then(function () { return view.mount(el, entry.params); })
            .then(function () { return entry; })
            .catch(function (err) {
                if (el.parentNode) { el.parentNode.removeChild(el); }
                throw err;
            });
    }

    function handleMountError(err, id) {
        var e = App.AppError.wrap(err);
        log.error('view mount basarisiz', id, e.code, e.detail);
        App.UI.Loading.hide();
        App.UI.Modal.alert('Ekran acilamadi', e.message + (e.detail ? '\n\n(' + e.detail + ')' : ''));
    }

    var R = {
        init: function (containerEl) {
            container = containerEl;
        },

        register: function (id, factory) { views[id] = factory; },

        has: function (id) { return !!views[id]; },

        current: function () {
            var t = top();
            return t ? t.id : null;
        },

        currentView: function () {
            var t = top();
            return t ? t.view : null;
        },

        depth: function () { return stack.length; },

        stackIds: function () {
            return stack.map(function (s) { return s.id; });
        },

        /** Yigina yeni ekran ekle */
        go: function (id, params) {
            if (transitioning) { return Promise.resolve(); }
            transitioning = true;

            var prev = top();
            if (prev && prev.view && typeof prev.view.onPause === 'function') {
                try { prev.view.onPause(); } catch (e) { log.error('onPause', e && e.message); }
            }

            return mountEntry(id, params).then(function (entry) {
                stack.push(entry);
                activate(entry);
                transitioning = false;
                log.info('go ->', id, '| yigin:', R.stackIds().join(' > '));
                return entry;
            }, function (err) {
                transitioning = false;
                /* Basarisiz olursa onceki ekrani geri canlandir */
                if (prev && prev.view && typeof prev.view.onResume === 'function') {
                    try { prev.view.onResume(); } catch (e2) { }
                }
                handleMountError(err, id);
            });
        },

        /** Mevcut ekrani DEGISTIR (yigin derinligi artmaz) */
        replace: function (id, params) {
            if (transitioning) { return Promise.resolve(); }
            transitioning = true;
            var old = stack.pop();

            return mountEntry(id, params).then(function (entry) {
                if (old) { destroyEntry(old); }
                stack.push(entry);
                activate(entry);
                transitioning = false;
                log.info('replace ->', id, '| yigin:', R.stackIds().join(' > '));
                return entry;
            }, function (err) {
                if (old) { stack.push(old); activate(old); }
                transitioning = false;
                handleMountError(err, id);
            });
        },

        /** Yigini temizleyip tek ekranla basla (login <-> home gecisi) */
        reset: function (id, params) {
            while (stack.length) { destroyEntry(stack.pop()); }
            return R.go(id, params);
        },

        /**
         * Geri git.
         * @returns {boolean} true => islendi
         */
        back: function () {
            if (transitioning) { return true; }

            var t = top();
            if (!t) { return false; }

            /* 1) View kendi ic durumunu geri alabilir mi?
                  (ornek: oynaticida acik kanal listesini kapatmak,
                   dizi detayinda bolum listesinden sezon listesine donmek) */
            if (t.view && typeof t.view.onBack === 'function') {
                var handled = false;
                try { handled = t.view.onBack() === true; }
                catch (e) { log.error('onBack', e && e.message); }
                if (handled) { return true; }
            }

            /* 2) Yiginda birden fazla ekran varsa ustteki kapanir */
            if (stack.length > 1) {
                var closing = stack.pop();
                destroyEntry(closing);
                var now = top();
                activate(now);
                if (now.view && typeof now.view.onResume === 'function') {
                    try { now.view.onResume(closing.result); }
                    catch (e3) { log.error('onResume', e3 && e3.message); }
                }
                log.info('back ->', now.id, '| yigin:', R.stackIds().join(' > '));
                return true;
            }

            /* 3) Kok ekrandayiz -> cikis onayi */
            R.confirmExit();
            return true;
        },

        /** Belirli bir ekrana kadar geri don (yoksa hicbir sey yapmaz) */
        backTo: function (id) {
            var idx = -1;
            for (var i = 0; i < stack.length; i++) { if (stack[i].id === id) { idx = i; } }
            if (idx < 0) { return false; }
            while (stack.length - 1 > idx) { destroyEntry(stack.pop()); }
            var t = top();
            activate(t);
            if (t.view && typeof t.view.onResume === 'function') {
                try { t.view.onResume(); } catch (e) { }
            }
            return true;
        },

        confirmExit: function () {
            App.UI.Modal.confirm(
                'Uygulamadan cikilsin mi?',
                'IPTV Player kapatilacak.',
                { okText: 'Cik', cancelText: 'Vazgec', danger: true }
            ).then(function (yes) {
                if (yes) { R.exitApp(); }
            });
        },

        /**
         * TIZEN API: tizen.application.getCurrentApplication().exit()
         * Uygulamayi tamamen kapatir. PC tarayicisinda hicbir sey yapmaz.
         */
        exitApp: function () {
            log.info('uygulamadan cikiliyor');
            try { App.Player.dispose(); } catch (e) { }
            try { App.Keys.unregister(); } catch (e2) { }
            try {
                if (window.tizen && tizen.application) {
                    tizen.application.getCurrentApplication().exit();
                    return;
                }
            } catch (e3) {
                log.error('exit basarisiz', e3 && e3.message);
            }
            /* PC tarayici fallback */
            try { window.close(); } catch (e4) { }
        }
    };

    App.Router = R;
})(window.App = window.App || {});
