/* ============================================================
   views/opensubtitles.js
   ALTYAZI SERVISI AYARLARI (OpenSubtitles)

   Kullanicidan API anahtari ve hesap bilgilerini alir.
   Anahtar UYGULAMAYA GOMULU DEGILDIR: servisin kullanim sartlari
   her uygulamanin kendi anahtarini kullanmasini gerektirir ve
   indirme kotasi anahtarin sahibine yazilir.

   Bilgiler yalnizca bu televizyonda saklanir; sifre
   App.Storage.setSecret() ile gizlenir.
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    var KEY = App.Keys.KEY;
    var log = App.Logger.get('OpenSubsView');

    App.Views = App.Views || {};

    var LANGS = [
        { code: 'tr', label: 'Turkce' },
        { code: 'en', label: 'Ingilizce' },
        { code: 'de', label: 'Almanca' },
        { code: 'fr', label: 'Fransizca' },
        { code: 'es', label: 'Ispanyolca' },
        { code: 'ar', label: 'Arapca' },
        { code: 'ru', label: 'Rusca' }
    ];

    App.Views.opensubtitles = function () {
        var root, f = {}, langRow = null, langIndex = 0;

        function currentLang() { return LANGS[langIndex].code; }

        function setLangFromCode(code) {
            for (var i = 0; i < LANGS.length; i++) {
                if (LANGS[i].code === code) { langIndex = i; return; }
            }
            langIndex = 0;
        }

        function paintLang() {
            if (langRow) {
                langRow.childNodes[1].textContent = LANGS[langIndex].label;
            }
        }

        function cycleLang() {
            langIndex = (langIndex + 1) % LANGS.length;
            paintLang();
        }

        function save() {
            if (!f.apiKey.getValue()) {
                App.UI.Modal.alert('API anahtari gerekli',
                    'Altyazi aramak icin OpenSubtitles API anahtari zorunludur.\n\n' +
                    'Nasil alinir:\n' +
                    '1. opensubtitles.com adresinde ucretsiz hesap acin\n' +
                    '2. Giris yapip Hesabim > API Consumers bolumune girin\n' +
                    '3. "New Consumer" ile bir anahtar olusturun\n' +
                    '4. Olusan anahtari buraya yapistirin');
                return;
            }

            App.OpenSubtitles.saveConfig({
                apiKey: f.apiKey.getValue(),
                username: f.username.getValue(),
                password: f.password.getValue(),
                language: currentLang()
            });

            /* Hesap girilmediyse de calisir; yalnizca kota daha dusuktur. */
            if (!App.OpenSubtitles.hasAccount()) {
                App.UI.Toast.success(
                    'Kaydedildi. Artik oynaticida SARI tusla altyazi indirebilirsiniz. ' +
                    '(Kullanici adi/sifre girerseniz gunluk kotaniz artar.)', 7000);
                App.Router.back();
                return;
            }

            App.UI.Loading.show('Hesap dogrulaniyor...', { delay: 0 });
            App.OpenSubtitles.login(true).then(function () {
                App.UI.Loading.hide(true);
                App.UI.Toast.success('OpenSubtitles hesabi dogrulandi');
                App.Router.back();
            }, function (err) {
                App.UI.Loading.hide(true);
                var e = App.AppError.wrap(err);
                App.UI.Modal.alert('Dogrulanamadi',
                    e.message + '\n\n' +
                    'API anahtarini, kullanici adini ve sifreyi kontrol edin.' +
                    (e.detail ? '\n\n(' + e.detail + ')' : ''));
            });
        }

        function clearAll() {
            App.UI.Modal.confirm('Bilgiler silinsin mi?',
                'API anahtari, kullanici adi ve sifre silinecek.',
                { danger: true, okText: 'Sil' }).then(function (yes) {
                    if (!yes) { return; }
                    App.OpenSubtitles.clearConfig();
                    App.UI.Toast.info('Altyazi servisi bilgileri silindi');
                    App.Router.back();
                });
        }

        return {
            id: 'opensubtitles',
            title: 'Altyazi Servisi',

            mount: function (container) {
                root = container;

                var bar = U.el('div', 'topbar');
                bar.appendChild(U.el('div', 'topbar__title', '💬 Altyazi Servisi'));
                bar.appendChild(U.el('div', 'topbar__spacer'));
                root.appendChild(bar);

                /* Iki kolonlu kart (giris ekraniyla ayni duzen): solda
                   aciklama, sagda form. Tek kolonda kart ekrana sigmiyordu. */
                var wrap = U.el('div', 'login');
                var card = U.el('div', 'login__card login__card--split');
                var aside = U.el('div', 'login__aside');
                var main = U.el('div', 'login__main');

                aside.appendChild(U.el('div', 't-h1', 'OpenSubtitles'));
                aside.appendChild(U.el('div', 'login__sub',
                    'Kaynaktaki altyazi bozuk veya eksik oldugunda internetten altyazi ' +
                    'indirebilmek icin kullanilir. Yalnizca API ANAHTARI yeterlidir; ' +
                    'bir kez girilir, bilgiler bu televizyonda saklanir.'));

                aside.appendChild(U.el('div', 'login__tip',
                    'Anahtar nasil alinir (bir defalik, ucretsiz): opensubtitles.com adresinde ' +
                    'hesap acin > Hesabim > API Consumers > "New Consumer" > cikan API Key\'i ' +
                    'buraya yapistirin. Kullanici adi ve sifre ZORUNLU DEGILDIR; girerseniz ' +
                    'gunluk indirme kotaniz artar.'));
                card.appendChild(aside);

                f.apiKey = App.UI.Field.create({
                    label: 'API Anahtari',
                    placeholder: 'OpenSubtitles API key',
                    isDefault: true
                });
                f.username = App.UI.Field.create({
                    label: 'Kullanici Adi  -  istege bagli',
                    placeholder: 'opensubtitles.com kullanici adiniz',
                    hint: 'Bos birakabilirsiniz. Girerseniz gunluk indirme kotaniz artar.'
                });
                f.password = App.UI.Field.create({
                    label: 'Sifre  -  istege bagli',
                    placeholder: 'Sifreniz',
                    type: 'password',
                    onSubmit: save
                });

                main.appendChild(f.apiKey.root);
                main.appendChild(f.username.root);
                main.appendChild(f.password.root);

                /* Sifreyi goster/gizle */
                var eyeRow = U.el('div', 'btn btn--ghost btn--block login__toggle');
                var eyeLbl = U.el('span', '', '👁  Sifreyi goster');
                eyeRow.appendChild(eyeLbl);
                App.Nav.bind(eyeRow, function () {
                    var secret = !f.password.isSecret();
                    f.password.setSecret(secret);
                    eyeLbl.textContent = secret ? '👁  Sifreyi goster' : '🙈  Sifreyi gizle';
                });
                main.appendChild(eyeRow);

                /* Arama dili (OK ile siradaki dile gecer) */
                langRow = U.el('div', 'srow');
                var langText = U.el('div', 'srow__text');
                langText.appendChild(U.el('div', 'srow__title', 'Altyazi Dili'));
                langText.appendChild(U.el('div', 'srow__desc', 'Degistirmek icin OK'));
                langRow.appendChild(langText);
                langRow.appendChild(U.el('div', 'srow__value', ''));
                App.Nav.bind(langRow, cycleLang);
                main.appendChild(langRow);

                /* Dugmeler */
                var actions = U.el('div', 'login__actions');
                var btnSave = U.el('button', 'btn btn--primary', 'Kaydet ve Dogrula');
                App.Nav.bind(btnSave, save);
                var btnClear = U.el('button', 'btn btn--danger', 'Bilgileri Sil');
                App.Nav.bind(btnClear, clearAll);
                actions.appendChild(btnSave);
                actions.appendChild(btnClear);
                main.appendChild(actions);

                card.appendChild(main);
                wrap.appendChild(card);
                root.appendChild(wrap);

                var hints = U.el('div', 'hintbar');
                hints.innerHTML =
                    '<span class="hint"><span class="hint__key">OK</span> Yaziyi duzenle</span>' +
                    '<span class="hint"><span class="hint__key">RETURN</span> Geri</span>';
                root.appendChild(hints);

                /* Kayitli degerleri doldur */
                var cfg = App.OpenSubtitles.getConfig();
                f.apiKey.setValue(cfg.apiKey);
                f.username.setValue(cfg.username);
                f.password.setValue(cfg.password);
                setLangFromCode(cfg.language);
                paintLang();

                App.Nav.focus(f.apiKey.box);
            },

            onKey: function () { return false; },

            unmount: function () { f = {}; langRow = null; }
        };
    };
})(window.App = window.App || {});
