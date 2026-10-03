/* ============================================================
   js/ui/field.js
   TV icin metin giris alani.

   SAMSUNG TV KLAVYESI (IME) NASIL CALISIR?
   Tizen'de bir <input> ogesine gercek DOM focus() uygulandiginda
   TV kendi ekran klavyesini otomatik acar. Kullanici yaziyi girip
   "Bitti"ye bastiginda Enter tusu gelir.

   Bu yuzden akis soyledir:
     1. Kutu [data-focusable] olarak gezinir (kumanda yon tuslari).
     2. OK/Enter -> input.focus()  => TV klavyesi acilir, .is-editing
     3. Enter veya Back -> input.blur() => klavye kapanir
     4. Duzenleme modunda yon tuslari IME'ye aittir; app.js global
        tus isleyicisi document.activeElement bir INPUT ise
        karismaz.
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    App.UI = App.UI || {};

    /**
     * @param {object} o {label, value, placeholder, type, hint, name, onChange, onSubmit}
     * @returns {object} {root, input, getValue, setValue, focusInput, setSecret}
     */
    function create(o) {
        o = o || {};

        var root = U.el('div', 'field');

        if (o.label) {
            root.appendChild(U.el('label', 'field__label', o.label));
        }

        var box = U.el('div', 'field__box');
        var input = U.el('input', 'field__input');
        input.type = o.type || 'text';
        input.value = o.value || '';
        input.setAttribute('placeholder', o.placeholder || '');
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('spellcheck', 'false');
        if (o.name) { input.setAttribute('name', o.name); }
        /* TV klavyesinde uygun duzen acilsin */
        if (o.inputMode) { input.setAttribute('inputmode', o.inputMode); }

        box.appendChild(input);
        root.appendChild(box);

        var hintEl = null;
        if (o.hint) {
            hintEl = U.el('div', 'field__hint', o.hint);
            root.appendChild(hintEl);
        }

        /* --- Duzenleme moduna girme / cikma --- */
        function startEdit() {
            box.classList.add('is-editing');
            try {
                input.focus();
                /* Imleci sona al */
                var len = input.value.length;
                if (input.setSelectionRange) { input.setSelectionRange(len, len); }
            } catch (e) { /* yoksay */ }
            App.Bus.emit('field:edit-start', api);
        }

        function stopEdit() {
            box.classList.remove('is-editing');
            try { input.blur(); } catch (e) { }
            App.Bus.emit('field:edit-stop', api);
            if (o.onChange) { o.onChange(input.value, api); }
        }

        input.addEventListener('blur', function () {
            box.classList.remove('is-editing');
        });

        input.addEventListener('keydown', function (ev) {
            var code = ev.keyCode;
            if (code === App.Keys.KEY.ENTER) {
                ev.preventDefault();
                ev.stopPropagation();
                stopEdit();
                if (o.onSubmit) { o.onSubmit(input.value, api); }
            } else if (code === App.Keys.KEY.BACK) {
                ev.preventDefault();
                ev.stopPropagation();
                stopEdit();
            }
        });

        /* Kutu, kumanda odagini alan ogedir */
        App.Nav.bind(box, startEdit, { isDefault: !!o.isDefault });

        var api = {
            root: root,
            box: box,
            input: input,
            name: o.name || '',

            getValue: function () { return input.value.trim(); },
            setValue: function (v) { input.value = (v === null || v === undefined) ? '' : String(v); },

            /** Sifre alanini gizle/goster */
            setSecret: function (secret) {
                input.type = secret ? 'password' : 'text';
            },
            isSecret: function () { return input.type === 'password'; },

            setHint: function (text, isError) {
                if (!hintEl) {
                    hintEl = U.el('div', 'field__hint');
                    root.appendChild(hintEl);
                }
                hintEl.textContent = text || '';
                U.toggleClass(hintEl, 'c-danger', !!isError);
            },

            markInvalid: function (on) {
                U.toggleClass(box, 'is-invalid', !!on);
                box.style.borderColor = on ? 'var(--danger)' : '';
            },

            startEdit: startEdit,
            stopEdit: stopEdit,
            focusBox: function () { App.Nav.focus(box); }
        };

        box.__field = api;
        return api;
    }

    /** Su an bir metin alani duzenleniyor mu? (app.js tus yonlendirmesi icin) */
    function isEditing() {
        var ae = document.activeElement;
        return !!(ae && ae.tagName === 'INPUT');
    }

    App.UI.Field = { create: create, isEditing: isEditing };
})(window.App = window.App || {});
