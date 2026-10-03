/* ============================================================
   views/login.js
   Giris ekrani - iki yontem:
     1) Xtream Codes : Server URL + Kullanici Adi + Sifre
     2) M3U / M3U8   : Playlist adresi (+ istege bagli EPG adresi)

   Sifre varsayilan olarak GIZLIDIR; "Sifreyi goster" satiri ile
   acilip kapatilabilir.

   NOT: Bu dosyada hicbir gercek sunucu adresi veya ornek hesap
   bilgisi yoktur; yer tutucular http://SERVER:PORT bicimindedir.
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    var KEY = App.Keys.KEY;
    var log = App.Logger.get('Login');

    App.Views = App.Views || {};

    App.Views.login = function () {
        var root, card, tabsEl, panes = {}, actions;
        var tabs = [];
        var mode = 'xtream';
        var f = {};                 /* alanlar */
        var showPassRow = null;
        var editingId = null;       /* duzenlenen playlistin id'si (yeni ise null) */
        var isAddMode = false;

        function buildTabs() {
            tabsEl = U.el('div', 'tabs');

            var defs = [
                { id: 'xtream', label: 'Xtream Codes' },
                { id: 'm3u', label: 'M3U / M3U8 Liste' }
            ];

            for (var i = 0; i < defs.length; i++) {
                (function (d) {
                    var t = U.el('div', 'tab', d.label);
                    t.setAttribute('data-tab', d.id);
                    App.Nav.bind(t, function () { setMode(d.id); });
                    tabsEl.appendChild(t);
                    tabs.push(t);
                })(defs[i]);
            }
            return tabsEl;
        }

        function setMode(id) {
            mode = id;
            for (var i = 0; i < tabs.length; i++) {
                U.toggleClass(tabs[i], 'is-selected', tabs[i].getAttribute('data-tab') === id);
            }
            U.toggleClass(panes.xtream, 'is-active', id === 'xtream');
            U.toggleClass(panes.m3u, 'is-active', id === 'm3u');
            App.Storage.trySet('login.lastMode', id);
        }

        function buildXtreamPane() {
            var p = U.el('div', 'login__pane');
            p.setAttribute('data-pane', 'xtream');

            f.host = App.UI.Field.create({
                label: 'Sunucu Adresi',
                placeholder: 'http://SERVER:PORT',
                hint: 'Ornek bicim: http://sunucu-adresi:8080  (http:// yazmazsaniz otomatik eklenir)',
                name: 'host',
                isDefault: true
            });

            f.username = App.UI.Field.create({
                label: 'Kullanici Adi',
                placeholder: 'USERNAME',
                name: 'username'
            });

            f.password = App.UI.Field.create({
                label: 'Sifre',
                placeholder: 'PASSWORD',
                type: 'password',
                name: 'password',
                onSubmit: function () { submit(); }
            });

            p.appendChild(f.host.root);
            p.appendChild(f.username.root);
            p.appendChild(f.password.root);

            /* Sifreyi goster/gizle satiri */
            showPassRow = U.el('div', 'btn btn--ghost btn--block login__toggle');
            var eye = U.el('span', '', '👁');
            var lbl = U.el('span', '', ' Sifreyi goster');
            showPassRow.appendChild(eye);
            showPassRow.appendChild(lbl);
            App.Nav.bind(showPassRow, function () {
                var nowSecret = !f.password.isSecret();
                f.password.setSecret(nowSecret);
                lbl.textContent = nowSecret ? ' Sifreyi goster' : ' Sifreyi gizle';
                eye.textContent = nowSecret ? '👁' : '🙈';
            });
            p.appendChild(showPassRow);

            return p;
        }

        function buildM3UPane() {
            var p = U.el('div', 'login__pane');
            p.setAttribute('data-pane', 'm3u');

            f.m3uUrl = App.UI.Field.create({
                label: 'M3U / M3U8 Playlist Adresi',
                placeholder: 'http://SERVER:PORT/get.php?username=USERNAME&password=PASSWORD&type=m3u_plus',
                hint: 'Saglayicinizin verdigi tam playlist baglantisini girin.',
                name: 'm3uUrl'
            });

            f.epgUrl = App.UI.Field.create({
                label: 'EPG (XMLTV) Adresi  -  istege bagli',
                placeholder: 'http://SERVER:PORT/xmltv.php?username=USERNAME&password=PASSWORD',
                hint: 'Bos birakabilirsiniz. Playlist icinde x-tvg-url varsa otomatik kullanilir.',
                name: 'epgUrl',
                onSubmit: function () { submit(); }
            });

            p.appendChild(f.m3uUrl.root);
            p.appendChild(f.epgUrl.root);
            return p;
        }

        function buildActions() {
            actions = U.el('div', 'login__actions');

            var connect = U.el('button', 'btn btn--primary', 'Baglan');
            App.Nav.bind(connect, submit);

            var help = U.el('button', 'btn', 'Yardim');
            App.Nav.bind(help, showHelp);

            actions.appendChild(connect);
            actions.appendChild(help);
            return actions;
        }

        function showHelp() {
            App.UI.Modal.alert(
                'Baglanti Yardimi',
                'XTREAM CODES\n' +
                '  Sunucu Adresi : http://SERVER:PORT bicimindedir (ornek: http://ornek-sunucu:8080)\n' +
                '  Kullanici Adi / Sifre : saglayicinizin verdigi bilgiler.\n\n' +
                'M3U / M3U8\n' +
                '  Saglayicinizin verdigi tam playlist baglantisini yapistirin.\n\n' +
                'Yazi girmek icin bir kutuya gelip OK tusuna basin; TV klavyesi acilir.\n' +
                'Yaziyi bitirince tekrar OK (veya Return) tusuna basin.\n\n' +
                'Bu uygulama hicbir kanal veya icerik saglamaz; yalnizca sizin\n' +
                'yasal erisim hakkina sahip oldugunuz yayinlari oynatir.'
            );
        }

        /* ---------------- Dogrulama + giris ---------------- */

        function validate() {
            var errors = [];

            if (mode === 'xtream') {
                f.host.markInvalid(false);
                f.username.markInvalid(false);
                f.password.markInvalid(false);

                if (!f.host.getValue()) { errors.push('Sunucu adresi bos olamaz.'); f.host.markInvalid(true); }
                else if (!/^(https?:\/\/)?[^\s\/]+/.test(f.host.getValue())) {
                    errors.push('Sunucu adresi gecersiz.'); f.host.markInvalid(true);
                }
                if (!f.username.getValue()) { errors.push('Kullanici adi bos olamaz.'); f.username.markInvalid(true); }
                if (!f.password.getValue()) { errors.push('Sifre bos olamaz.'); f.password.markInvalid(true); }
            } else {
                f.m3uUrl.markInvalid(false);
                var url = f.m3uUrl.getValue();
                if (!url) { errors.push('Playlist adresi bos olamaz.'); f.m3uUrl.markInvalid(true); }
                else if (!/^https?:\/\//i.test(url)) {
                    errors.push('Playlist adresi http:// veya https:// ile baslamalidir.');
                    f.m3uUrl.markInvalid(true);
                }
            }
            return errors;
        }

        function submit() {
            var errors = validate();
            if (errors.length) {
                App.UI.Modal.alert('Eksik Bilgi', errors.join('\n'));
                return;
            }

            var profile = (mode === 'xtream')
                ? {
                    id: editingId,
                    name: f.name.getValue(),
                    type: 'xtream',
                    host: f.host.getValue(),
                    username: f.username.getValue(),
                    password: f.password.getValue()
                }
                : {
                    id: editingId,
                    name: f.name.getValue(),
                    type: 'm3u',
                    m3uUrl: f.m3uUrl.getValue(),
                    epgUrl: f.epgUrl.getValue()
                };

            App.UI.Loading.show(mode === 'xtream' ? 'Hesap dogrulaniyor...' : 'Playlist yukleniyor...', { delay: 0 });

            /* Yeni kayit mi, var olanin duzenlenmesi mi? Basarisiz olursa
               yeni olusturulan yarim kayit geri alinir (asagida). */
            var wasNew = !editingId;
            App.Profile.save(profile);
            editingId = App.Profiles.activeId();   /* tekrar denemede kopya olusmasin */
            App.Favorites.invalidate();
            App.History.invalidate();

            var chain;
            if (mode === 'xtream') {
                chain = App.Content.init().then(function () {
                    return App.Xtream.login();
                }).then(function (res) {
                    App.Profile.setUserInfo(res.userInfo);
                    App.UI.Loading.setMessage('Kanal listesi hazirlaniyor...');
                    /* Kategorileri onden cekerek ana ekrani hizli acalim */
                    return App.Content.getLiveCategories(true).then(function () { return res; },
                        function () { return res; });
                });
            } else {
                chain = App.Content.init({
                    force: true,
                    onStatus: function (t) { App.UI.Loading.setProgress(t); }
                });
            }

            chain.then(function () {
                App.UI.Loading.hide(true);
                App.UI.Toast.success('Baglanti basarili - playlist kaydedildi');
                App.Router.reset('home');
            }, function (err) {
                App.UI.Loading.hide(true);
                onLoginError(App.AppError.wrap(err), wasNew);
            });
        }

        function onLoginError(e, wasNew) {
            log.error('giris basarisiz', e.code, e.detail);

            /* Aktif secim kaldirilir ki uygulama hatali hesapla acilmaya
               calismasin. Kayit YENI olusturulduysa yarim kalmis girdiyi de
               temizleriz; var olan bir playlist duzenleniyorduysa DOKUNMAYIZ
               (kullanici eski calisan haline geri donebilmeli). */
            var newId = App.Profiles.activeId();
            App.Profile.logout();
            if (wasNew && newId) {
                App.Profiles.remove(newId);
                editingId = null;
            }

            var extra = '';
            if (e.code === App.ERR.NETWORK || e.code === App.ERR.OFFLINE) {
                extra = '\n\nKontrol edin:\n' +
                        '  • TV internete bagli mi?\n' +
                        '  • Sunucu adresi ve port dogru mu?\n' +
                        '  • Adres http:// ile mi baslamali, https:// ile mi?';
            } else if (e.code === App.ERR.AUTH) {
                extra = '\n\nKullanici adi ve sifreyi buyuk/kucuk harfe dikkat ederek tekrar girin.';
            } else if (e.code === App.ERR.PARSE) {
                extra = '\n\nGirdiginiz adres bir Xtream Codes paneli olmayabilir.\n' +
                        'M3U listesi kullaniyorsaniz "M3U / M3U8 Liste" sekmesini deneyin.';
            } else if (e.code === App.ERR.EMPTY) {
                extra = '\n\nPlaylist bos gorunuyor. Adresi ve hesabinizin aktif oldugunu kontrol edin.';
            }

            App.UI.Modal.retry('Baglanti Basarisiz', e.message + extra)
                .then(function (choice) {
                    if (choice === 'retry') { submit(); }
                    else if (f.host && mode === 'xtream') { f.host.focusBox(); }
                });
        }

        /* ---------------- View arayuzu ---------------- */
        return {
            id: 'login',
            title: 'Giris',

            mount: function (container, params) {
                root = container;

                /* Iki kolonlu kart: solda marka + aciklamalar, sagda form.
                   (Tek kolonda kart ekrandan uzundu; ustu ve "Baglan"
                   butonu kesiliyordu.) */
                var wrap = U.el('div', 'login');
                card = U.el('div', 'login__card login__card--split');
                var aside = U.el('div', 'login__aside');
                var main = U.el('div', 'login__main');

                var brand = U.el('div', 'login__brand');

                /* Uygulama ikonu. Yuklenemezse altindaki degrade + ▶ gorunur
                   kalir (CSS'te tanimli), yani bos kutu olusmaz. */
                var logoBox = U.el('div', 'login__logo', '▶');
                var logoImg = U.el('img', 'login__logo-img');
                logoImg.setAttribute('src', 'assets/icon.png');
                logoImg.setAttribute('alt', '');
                logoImg.onerror = function () {
                    if (logoImg.parentNode) { logoImg.parentNode.removeChild(logoImg); }
                };
                logoBox.appendChild(logoImg);
                brand.appendChild(logoBox);

                brand.appendChild(U.el('div', 't-h1', 'IPTV Player'));
                aside.appendChild(brand);
                aside.appendChild(U.el('div', 'login__sub',
                    'Hesap bilgilerinizi girerek baslayin. Bilgileriniz yalnizca bu televizyonda saklanir.'));

                /* Uzun adresleri kumandayla yazmak zordur. Samsung TV'lerde
                   telefonu klavye olarak kullanmak mumkundur (SmartThings);
                   bu tamamen TV'nin kendi ozelligidir, ek kod gerektirmez. */
                aside.appendChild(U.el('div', 'login__tip',
                    'Ipucu: Uzun adresi telefonunuzdan yapistirabilirsiniz. Bir kutuya gelip OK ' +
                    'tusuna basin, ardindan telefonunuzdaki SmartThings uygulamasindan TV\'nizi secip ' +
                    'klavye simgesine dokunun.'));
                /* Uygulama her yeniden kurulumda kayitli hesaplari siler;
                   linki bir kez dosyaya yazmak bunu kalici cozer
                   (services/presets.js). */
                aside.appendChild(U.el('div', 'login__tip login__tip--info',
                    'Her build\'de yeniden yazmamak icin: linkinizi bilgisayarda proje ' +
                    'klasorundeki hesaplar.txt dosyasina bir kez yapistirin. Uygulama ' +
                    'her kurulumda hesabi kendisi ekler.'));
                aside.appendChild(U.el('div', 'login__note',
                    'Bu uygulama hicbir kanal veya icerik saglamaz; yalnizca yasal erisim ' +
                    'hakkiniz olan yayinlari oynatir.'));
                card.appendChild(aside);

                /* Playlist adi - listede bu adla gorunur */
                f.name = App.UI.Field.create({
                    label: 'Playlist Adi',
                    placeholder: 'Ornek: Ev Hesabi',
                    hint: 'Bos birakirsaniz kullanici adi veya "M3U Listesi" kullanilir.',
                    name: 'name'
                });
                main.appendChild(f.name.root);

                main.appendChild(buildTabs());

                panes.xtream = buildXtreamPane();
                panes.m3u = buildM3UPane();
                main.appendChild(panes.xtream);
                main.appendChild(panes.m3u);

                main.appendChild(buildActions());
                card.appendChild(main);
                wrap.appendChild(card);
                root.appendChild(wrap);

                /* Alt ipucu cubugu */
                var hints = U.el('div', 'hintbar');
                hints.innerHTML =
                    '<span class="hint"><span class="hint__key">OK</span> Yaziyi duzenle</span>' +
                    '<span class="hint"><span class="hint__key">◀ ▶ ▲ ▼</span> Gezin</span>' +
                    '<span class="hint"><span class="hint__key">RETURN</span> Geri / Klavyeyi kapat</span>';
                root.appendChild(hints);

                /* Son kullanilan sekme + varsa kayitli degerler */
                var last = App.Storage.get('login.lastMode', 'xtream');
                setMode(last === 'm3u' ? 'm3u' : 'xtream');

                /* Uc calisma bicimi:
                     params.editId -> var olan bir playlisti duzenle
                     params.mode='add' -> bos formla YENI playlist ekle
                     (parametresiz) -> aktif profili duzenle (ilk kurulum) */
                isAddMode = !!(params && params.mode === 'add');
                editingId = (params && params.editId) || null;

                var p = null;
                if (editingId) {
                    p = App.Profiles.get(editingId);
                } else if (!isAddMode) {
                    p = App.Profile.get();
                    if (p) { editingId = App.Profiles.activeId(); }
                }

                if (p) {
                    f.name.setValue(p.name || '');
                    if (p.type === 'xtream') {
                        f.host.setValue(p.host);
                        f.username.setValue(p.username);
                        f.password.setValue(p.password);
                        setMode('xtream');
                    } else if (p.type === 'm3u') {
                        f.m3uUrl.setValue(p.m3uUrl);
                        f.epgUrl.setValue(p.epgUrl);
                        setMode('m3u');
                    }
                }

                App.Nav.focus(tabs[mode === 'm3u' ? 1 : 0]);
            },

            onKey: function (code) {
                /* Sekmeler arasi hizli gecis: renkli tuslar */
                if (code === KEY.RED) { setMode('xtream'); return true; }
                if (code === KEY.GREEN) { setMode('m3u'); return true; }
                return false;
            },

            /* Kok ekran: Back -> cikis onayi (Router halleder) */
            onBack: function () { return false; },

            unmount: function () {
                f = {};
                tabs = [];
                editingId = null;
            }
        };
    };
})(window.App = window.App || {});
