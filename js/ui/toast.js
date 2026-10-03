/* ============================================================
   js/ui/toast.js - Kisa bilgilendirme mesajlari
   Odagi calmaz, kumandayi engellemez. Hatalar icin kullanicinin
   karar vermesi gerekmiyorsa Modal yerine bunu kullanin.
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    App.UI = App.UI || {};

    var wrap = null;
    var MAX = 3;

    function build() {
        if (wrap) { return; }
        wrap = U.el('div', 'toast-wrap');
        document.getElementById('overlay-root').appendChild(wrap);
    }

    function show(msg, type, ms) {
        build();
        if (!msg) { return; }

        while (wrap.children.length >= MAX) { wrap.removeChild(wrap.firstChild); }

        var t = U.el('div', 'toast' + (type ? ' toast--' + type : ''), msg);
        wrap.appendChild(t);

        setTimeout(function () {
            if (t.parentNode) { t.parentNode.removeChild(t); }
        }, ms || 3200);
    }

    App.UI.Toast = {
        show: show,
        info: function (m, ms) { show(m, null, ms); },
        success: function (m, ms) { show(m, 'success', ms); },
        warn: function (m, ms) { show(m, 'warn', ms); },
        error: function (m, ms) { show(m, 'error', ms || 4500); },

        /** AppError'i dogrudan gostermek icin kisayol */
        fromError: function (err, prefix) {
            var e = App.AppError.wrap(err);
            var firstLine = e.message.split('\n')[0];
            show((prefix ? prefix + ' ' : '') + firstLine, 'error', 4500);
        },

        clear: function () { if (wrap) { U.empty(wrap); } }
    };
})(window.App = window.App || {});
