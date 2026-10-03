/* ============================================================
   js/ui/loading.js - Tam ekran yukleniyor gostergesi
   Sayac tabanlidir: ic ice cagrilarda hide() ancak son show()
   kapatildiginda gercekten gizlenir.
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    App.UI = App.UI || {};

    var root = null, box = null, msgEl = null, subEl = null;
    var count = 0;
    var showTimer = null;

    function build() {
        if (box) { return; }
        root = document.getElementById('overlay-root');
        box = U.el('div', 'loading hidden');
        var sp = U.el('div', 'spinner');
        msgEl = U.el('div', 'loading__msg', 'Yukleniyor...');
        subEl = U.el('div', 'loading__sub hidden');
        box.appendChild(sp);
        box.appendChild(msgEl);
        box.appendChild(subEl);
        root.appendChild(box);
    }

    App.UI.Loading = {
        /**
         * @param {string} [msg]
         * @param {object} [opts] {delay:ms - bu sureden once biterse hic gosterme}
         */
        show: function (msg, opts) {
            build();
            count++;
            if (msg) { msgEl.textContent = msg; }
            subEl.classList.add('hidden');

            var delay = (opts && opts.delay !== undefined) ? opts.delay : 180;
            if (showTimer) { clearTimeout(showTimer); }
            showTimer = setTimeout(function () {
                showTimer = null;
                if (count > 0) { box.classList.remove('hidden'); }
            }, delay);
        },

        setMessage: function (msg) {
            build();
            msgEl.textContent = msg || '';
        },

        /** Alt satirda ilerleme metni (ornek: "12.480 kanal islendi") */
        setProgress: function (text) {
            build();
            if (!text) { subEl.classList.add('hidden'); return; }
            subEl.textContent = text;
            subEl.classList.remove('hidden');
        },

        hide: function (force) {
            build();
            count = force ? 0 : Math.max(0, count - 1);
            if (count === 0) {
                if (showTimer) { clearTimeout(showTimer); showTimer = null; }
                box.classList.add('hidden');
                subEl.classList.add('hidden');
            }
        },

        isVisible: function () { return !!box && !box.classList.contains('hidden'); }
    };
})(window.App = window.App || {});
