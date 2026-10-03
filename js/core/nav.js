/* ============================================================
   js/core/nav.js
   Kumanda yon tuslariyla odak (focus) yonetimi.

   TASARIM: TV'de gercek DOM focus'u kullanmiyoruz (eski Tizen
   surumlerinde <div> focus'u tutarsiz calisir ve TV bazen kendi
   odak halkasini cizer). Bunun yerine odaklanabilir her ogeye
   [data-focusable] veriyoruz ve secili olana .is-focused sinifini
   ekliyoruz. Yalnizca <input> ogelerinde gercek .focus() cagrilir,
   cunku TV sanal klavyesinin (IME) acilmasi buna baglidir.

   ALGORITMA: Geometrik "spatial navigation". Odakli ogenin
   dikdortgeninden yon dogrultusunda en yakin ogeyi secer.
   Ana eksen mesafesi + capraz sapma*3 seklinde puanlanir.

   OZEL DURUM: data-nav-left / -right / -up / -down attribute'u
   ile bir ogeye elle hedef verebilirsiniz:
       data-nav-left="#cat-list"    -> o secicideki ogeye git
       data-nav-up="none"           -> bu yonde hareketi engelle
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('Nav');
    var U = App.Utils;

    var focused = null;
    var scope = null;             /* Arama yapilacak kok eleman (aktif view) */
    var enabled = true;

    function isVisible(el) {
        if (!el || el.classList.contains('hidden')) { return false; }
        if (el.getAttribute('data-focus-disabled') === 'true') { return false; }
        /* offsetParent null => display:none (position:fixed haric, TV'de kullanmiyoruz) */
        return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    }

    function candidates() {
        var root = scope || document.getElementById('app') || document.body;
        var nodes = root.querySelectorAll('[data-focusable]');
        var out = [];
        for (var i = 0; i < nodes.length; i++) {
            if (isVisible(nodes[i])) { out.push(nodes[i]); }
        }
        return out;
    }

    function rectOf(el) { return el.getBoundingClientRect(); }
    function cx(r) { return r.left + r.width / 2; }
    function cy(r) { return r.top + r.height / 2; }

    /** Iki aralik ne kadar ortusuyor (negatifse ortusme yok) */
    function overlap1D(a1, a2, b1, b2) {
        return Math.min(a2, b2) - Math.max(a1, b1);
    }

    /**
     * Odakli ogeyi kaydirilabilir atasinin gorunur alanina getirir.
     * (Sanal listeler kendi kaydirmasini yaptigi icin burada yalnizca
     *  overflow:auto/scroll olan basit kapsayicilar hedeflenir.)
     */
    function ensureVisible(el) {
        /* PERFORMANS: Sanal listeler kendi kaydirmasini yapar; onlar icin
           atalari dolasip getComputedStyle cagirmak (her odak degisiminde
           zorunlu layout) tamamen gereksizdir. */
        if (el.__vlist) { return; }

        var p = el.parentElement;
        var depth = 0;
        while (p && p !== document.body && depth++ < 6) {
            var style = window.getComputedStyle(p);
            var scrollableY = (style.overflowY === 'auto' || style.overflowY === 'scroll');
            if (scrollableY && p.scrollHeight > p.clientHeight + 2) {
                var er = el.getBoundingClientRect();
                var pr = p.getBoundingClientRect();
                var pad = 24;
                if (er.top < pr.top + pad) {
                    p.scrollTop -= (pr.top + pad - er.top);
                } else if (er.bottom > pr.bottom - pad) {
                    p.scrollTop += (er.bottom - pr.bottom + pad);
                }
                return;
            }
            p = p.parentElement;
        }
    }

    function setFocus(el, silent) {
        if (!el || el === focused) { return !!el; }
        if (focused) {
            focused.classList.remove('is-focused');
            if (focused.__navBlur) { try { focused.__navBlur(focused); } catch (e) { } }
        }
        focused = el;
        el.classList.add('is-focused');
        ensureVisible(el);
        if (el.__navFocus) { try { el.__navFocus(el); } catch (e2) { } }
        if (!silent) {
            App.Bus.emit('nav:focus', el);
        }
        return true;
    }

    function moveDir(dir) {
        if (!enabled) { return false; }
        if (!focused || !isVisible(focused)) { return N.focusFirst(); }

        /* 1) Elle tanimlanmis hedef var mi? */
        var override = focused.getAttribute('data-nav-' + dir);
        if (override) {
            if (override === 'none') { return true; }    /* hareketi yut */
            var target = (scope || document).querySelector(override);
            if (target && isVisible(target)) { return setFocus(target); }
            /* Hedef gorunur degilse normal aramaya devam et */
        }

        var cur = rectOf(focused);
        var x0 = cx(cur), y0 = cy(cur);
        var vertical = (dir === 'up' || dir === 'down');
        var list = candidates();
        var best = null, bestScore = Infinity;

        /* HIZALAMA CEZASI:
           Dikey harekette kaynakla YATAY olarak kesisen ogeler,
           kesismeyen her ogeyi daima yener (ve tersi).

           Neden gerekli: Giris ekraninda sekmeden asagi basildiginda
           tam genislikteki metin kutularinin MERKEZI sekmenin merkezinden
           uzaktir; oysa cok daha asagidaki "Baglan" butonu tam hizalidir.
           Saf merkez-mesafesi puanlamasi kutulari atlayip butona atliyordu.
           Bu ceza ile once hizali adaylar, sonra en yakin olan secilir. */
        var MISALIGN_PENALTY = 100000;

        for (var i = 0; i < list.length; i++) {
            var e = list[i];
            if (e === focused) { continue; }
            var r = rectOf(e);
            if (r.width === 0 && r.height === 0) { continue; }

            var primary, cross;
            /* Yon filtreleri: hedef, kaynak kenarinin otesinde olmali */
            if (dir === 'left') {
                if (r.right > cur.left + 2) { continue; }
                primary = cur.left - r.right;
                cross = Math.abs(cy(r) - y0);
            } else if (dir === 'right') {
                if (r.left < cur.right - 2) { continue; }
                primary = r.left - cur.right;
                cross = Math.abs(cy(r) - y0);
            } else if (dir === 'up') {
                if (r.bottom > cur.top + 2) { continue; }
                primary = cur.top - r.bottom;
                cross = Math.abs(cx(r) - x0);
            } else { /* down */
                if (r.top < cur.bottom - 2) { continue; }
                primary = r.top - cur.bottom;
                cross = Math.abs(cx(r) - x0);
            }

            var ov = vertical
                ? overlap1D(cur.left, cur.right, r.left, r.right)
                : overlap1D(cur.top, cur.bottom, r.top, r.bottom);
            var aligned = ov > 2;

            var score = primary + (aligned ? 0 : (cross * 2 + MISALIGN_PENALTY));
            if (score < bestScore) { bestScore = score; best = e; }
        }

        if (best) { return setFocus(best); }
        return false;
    }

    var N = {
        /** Aktif view degistiginde cagrilir; arama alanini daraltir (performans) */
        setScope: function (el) { scope = el || null; },
        getScope: function () { return scope; },

        setEnabled: function (v) { enabled = !!v; },
        isEnabled: function () { return enabled; },

        focus: setFocus,
        get: function () { return focused; },

        clear: function () {
            if (focused) { focused.classList.remove('is-focused'); }
            focused = null;
        },

        /**
         * Kapsayicidaki ilk odaklanabilir ogeye (veya
         * [data-focus-default] isaretlisine) odaklanir.
         */
        focusFirst: function (container) {
            var root = container || scope || document.getElementById('app');
            if (!root) { return false; }
            var pref = root.querySelector('[data-focus-default]');
            if (pref && isVisible(pref)) { return setFocus(pref); }
            var list = candidates();
            /* Sadece verilen kapsayicinin icindekiler */
            for (var i = 0; i < list.length; i++) {
                if (root === list[i] || root.contains(list[i])) { return setFocus(list[i]); }
            }
            return false;
        },

        /** Secici ile odakla */
        focusSelector: function (sel) {
            var el = (scope || document).querySelector(sel);
            if (el && isVisible(el)) { return setFocus(el); }
            return false;
        },

        move: moveDir,
        ensureVisible: ensureVisible,

        /**
         * OK/Enter tusu: odakli ogenin eylemini calistir.
         * View'lar ogeye el.__navEnter = fn atayabilir; yoksa click() denenir.
         */
        activate: function () {
            if (!focused) { return false; }
            if (typeof focused.__navEnter === 'function') {
                focused.__navEnter(focused);
                return true;
            }
            if (typeof focused.click === 'function') { focused.click(); return true; }
            return false;
        },

        /**
         * Odaklanabilir oge kaydi icin yardimci.
         *   Nav.bind(el, onEnter, {onFocus, onBlur, default:true})
         */
        bind: function (el, onEnter, opts) {
            opts = opts || {};
            el.setAttribute('data-focusable', '');
            if (opts.isDefault) { el.setAttribute('data-focus-default', ''); }
            if (onEnter) { el.__navEnter = onEnter; }
            if (opts.onFocus) { el.__navFocus = opts.onFocus; }
            if (opts.onBlur) { el.__navBlur = opts.onBlur; }
            return el;
        },

        /** Odakli oge silinmek uzereyse guvenli sekilde birak */
        releaseIfInside: function (container) {
            if (focused && container && container.contains(focused)) {
                focused.classList.remove('is-focused');
                focused = null;
            }
        }
    };

    App.Nav = N;
})(window.App = window.App || {});
