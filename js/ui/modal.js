/* ============================================================
   js/ui/modal.js - Onay / uyari / secim pencereleri
   Acikken TUM kumanda tuslarini kendisi isler (app.js once
   Modal.isOpen() kontrol eder). Boylece arka plandaki ekran
   yanlislikla tepki vermez.
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    var KEY = App.Keys.KEY;
    App.UI = App.UI || {};

    var backdrop = null;
    var currentState = null;   /* {items:[el], index:int, resolve:fn} */

    function build() {
        if (backdrop) { return; }
        backdrop = U.el('div', 'modal-back hidden');
        document.getElementById('overlay-root').appendChild(backdrop);
    }

    function paintFocus() {
        if (!currentState) { return; }
        for (var i = 0; i < currentState.items.length; i++) {
            U.toggleClass(currentState.items[i], 'is-focused', i === currentState.index);
        }
        ensureVisible(currentState.items[currentState.index]);

        /* Uzun listede "kacinci secenek" bilgisi (ornek: 7 / 20) */
        if (currentState.countEl && currentState.optionCount) {
            var n = Math.min(currentState.index + 1, currentState.optionCount);
            currentState.countEl.textContent = n + ' / ' + currentState.optionCount;
        }
    }

    /**
     * Uzun seceneklerde odakli satiri kaydirilabilir listede gorunur tut.
     *
     * ONCEKI HATA: .modal__list konumlandirilmamisti; offsetTop listeye
     * degil tum arka plana gore olculuyordu (modalin ekrandaki konumu kadar
     * fazla). Asagi inildikce liste gereginden cok kayiyor, secili satir
     * bir anda en uste firlayip ustten kesiliyordu. CSS'te liste artik
     * position:relative; burada da bir satirlik on izleme birakilir ki
     * secili satir kenara yapismasin.
     */
    function ensureVisible(el) {
        if (!el) { return; }
        var p = el.parentNode;
        if (!p || !p.classList || !p.classList.contains('modal__list')) { return; }
        var top = el.offsetTop;
        var h = el.offsetHeight;
        var bottom = top + h;
        var view = p.clientHeight;
        var pad = Math.min(h, Math.max(0, Math.floor((view - h) / 2)));

        if (top - pad < p.scrollTop) {
            p.scrollTop = Math.max(0, top - pad);
        } else if (bottom + pad > p.scrollTop + view) {
            p.scrollTop = bottom + pad - view;
        }
        U.toggleClass(p, 'has-more-above', p.scrollTop > 2);
        U.toggleClass(p, 'has-more-below', p.scrollTop + view < p.scrollHeight - 2);
    }

    function close(result) {
        if (!currentState) { return; }
        var res = currentState.resolve;
        currentState = null;
        backdrop.classList.add('hidden');
        U.empty(backdrop);
        /* Modal kapaninca arka plandaki view odagini geri kazanir */
        App.Bus.emit('modal:close');
        if (res) { res(result); }
    }

    /**
     * Genel modal olusturucu.
     * @param {object} cfg {title, message, buttons:[{text, value, className}], defaultIndex, vertical}
     * @returns {Promise} secilen buton value'su
     */
    function open(cfg) {
        build();
        /* Ust uste modal acilmasin: oncekini iptal et */
        if (currentState) { close(undefined); }

        return new Promise(function (resolve) {
            var box = U.el('div', 'modal');

            if (cfg.title) { box.appendChild(U.el('div', 'modal__title', cfg.title)); }
            if (cfg.message) { box.appendChild(U.el('div', 'modal__msg', cfg.message)); }

            var items = [];
            var countEl = null;

            if (cfg.options) {
                /* Dikey secim listesi */
                var listWrap = U.el('div', 'modal__list');
                for (var i = 0; i < cfg.options.length; i++) {
                    (function (opt) {
                        var row = U.el('div', 'modal__opt');
                        /* Simge / etiket / ipucu ayri sutunlarda dursun ki
                           ✔ isareti tum satirlarda ayni hizada olsun. */
                        row.appendChild(U.el('span', 'modal__opt-icon', opt.icon || '•'));
                        row.appendChild(U.el('span', 'modal__opt-label', opt.label));
                        row.appendChild(U.el('span', 'modal__opt-hint', opt.hint || ''));
                        /* Su an etkin olan secenek (odaktan bagimsiz isaret) */
                        if (opt.current) { row.classList.add('is-current'); }
                        row.__value = opt.value;
                        listWrap.appendChild(row);
                        items.push(row);
                    })(cfg.options[i]);
                }
                box.appendChild(listWrap);
                if (cfg.options.length > 6) {
                    countEl = U.el('div', 'modal__count', '');
                    box.appendChild(countEl);
                }
            }

            if (cfg.buttons && cfg.buttons.length) {
                var btns = U.el('div', 'modal__btns');
                for (var j = 0; j < cfg.buttons.length; j++) {
                    (function (b) {
                        var el = U.el('button', 'btn ' + (b.className || ''), b.text);
                        el.__value = b.value;
                        btns.appendChild(el);
                        items.push(el);
                    })(cfg.buttons[j]);
                }
                box.appendChild(btns);
            }

            backdrop.appendChild(box);
            backdrop.classList.remove('hidden');

            currentState = {
                items: items,
                index: U.clamp(cfg.defaultIndex || 0, 0, Math.max(0, items.length - 1)),
                resolve: resolve,
                horizontal: !cfg.options,     /* butonlar yatay, secenekler dikey */
                cancelValue: cfg.cancelValue,
                countEl: countEl,
                optionCount: cfg.options ? cfg.options.length : 0
            };
            paintFocus();
            App.Bus.emit('modal:open');
        });
    }

    App.UI.Modal = {
        isOpen: function () { return !!currentState; },

        /** @returns {Promise<void>} */
        alert: function (title, message, okText) {
            return open({
                title: title,
                message: message,
                buttons: [{ text: okText || 'Tamam', value: true, className: 'btn--primary' }],
                cancelValue: true
            });
        },

        /** @returns {Promise<boolean>} */
        confirm: function (title, message, opts) {
            opts = opts || {};
            return open({
                title: title,
                message: message,
                buttons: [
                    { text: opts.okText || 'Evet', value: true,
                      className: opts.danger ? 'btn--danger' : 'btn--primary' },
                    { text: opts.cancelText || 'Hayir', value: false }
                ],
                defaultIndex: opts.defaultIndex !== undefined ? opts.defaultIndex : 1,
                cancelValue: false
            }).then(function (v) { return v === true; });
        },

        /**
         * Dikey secim listesi.
         * @param {string} title
         * @param {Array<{label,value,icon,hint}>} options
         * @returns {Promise} secilen value veya undefined (iptal)
         */
        choose: function (title, options, opts) {
            opts = opts || {};
            return open({
                title: title,
                message: opts.message,
                options: options,
                defaultIndex: opts.defaultIndex || 0,
                cancelValue: undefined
            });
        },

        /** Hata + "Tekrar Dene" kalibi */
        retry: function (title, message, opts) {
            opts = opts || {};
            return open({
                title: title,
                message: message,
                buttons: [
                    { text: 'Tekrar Dene', value: 'retry', className: 'btn--primary' },
                    { text: opts.secondText || 'Geri Don', value: 'back' }
                ],
                cancelValue: 'back'
            });
        },

        close: close,

        /** app.js tarafindan cagrilir. @returns {boolean} tus tuketildi mi */
        onKey: function (code) {
            if (!currentState) { return false; }
            var s = currentState;

            switch (code) {
                case KEY.UP:
                case KEY.LEFT:
                    if ((code === KEY.LEFT) !== s.horizontal) { return true; }
                    s.index = (s.index - 1 + s.items.length) % s.items.length;
                    paintFocus();
                    return true;

                case KEY.DOWN:
                case KEY.RIGHT:
                    if ((code === KEY.RIGHT) !== s.horizontal) { return true; }
                    s.index = (s.index + 1) % s.items.length;
                    paintFocus();
                    return true;

                case KEY.ENTER:
                case KEY.PLAY_PAUSE:
                    var el = s.items[s.index];
                    close(el ? el.__value : undefined);
                    return true;

                case KEY.BACK:
                case KEY.EXIT:
                    close(s.cancelValue);
                    return true;

                default:
                    return true;   /* Modal acikken hicbir tus arkaya gecmez */
            }
        }
    };
})(window.App = window.App || {});
