/* ============================================================
   views/playlists.js
   PLAYLISTLERIM  -  birden fazla hesap/liste kaydet ve aralarinda gec

   Sol  : kayitli playlistler (+ "Yeni playlist ekle" satiri)
   Sag  : secili playlistin bilgileri + QR KODU

   QR KODU NE ISE YARAR?
   Telefonunuzun kamerasiyla okutunca playlist adresini telefona
   aktarirsiniz; baska bir cihaza/uygulamaya kurmak veya yedeklemek
   icin kullanabilirsiniz. Xtream hesaplari icin standart get.php
   M3U baglantisi uretilir (her IPTV oynaticida calisir).

   DIKKAT: QR icindeki adres kullanici adi ve sifreyi ICERIR;
   bu yuzden ekranda acik bir uyari gosterilir.

   Kumanda:
     OK       bu playliste gec
     YESIL    yeni playlist ekle
     SARI     duzenle (ad / sunucu / sifre)
     KIRMIZI  sil
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    var KEY = App.Keys.KEY;
    var log = App.Logger.get('Playlists');

    App.Views = App.Views || {};

    App.Views.playlists = function () {
        var root, listHost, sideEl, headEl;
        var list = null;
        var rows = [];
        var destroyed = false;

        /* ---------------- Satir cizimi ---------------- */

        function createRow(node) {
            node.style.height = U.rem(6) + 'px';
            var texts = U.el('div', 'ch__texts');
            var r = node.__r = {
                glyph: U.el('span', 'srow__glyph'),
                name: U.el('div', 'ch__name'),
                sub: U.el('div', 'ch__epg'),
                mark: U.el('span', 'ch__fav')
            };
            texts.appendChild(r.name);
            texts.appendChild(r.sub);
            node.appendChild(r.glyph);
            node.appendChild(texts);
            node.appendChild(r.mark);
        }

        function updateRow(node, item) {
            var r = node.__r;

            if (item.__add) {
                r.glyph.textContent = '➕';
                r.name.textContent = 'Yeni playlist ekle';
                r.sub.textContent = 'Xtream Codes hesabi veya M3U adresi';
                r.mark.textContent = '';
                return;
            }

            r.glyph.textContent = item.type === 'xtream' ? '🔑' : '📄';
            r.name.textContent = item.name;
            r.sub.textContent = item.type === 'xtream'
                ? (item.host + '  •  ' + item.username)
                : U.truncate(item.m3uUrl, 70);
            r.mark.textContent = (item.id === App.Profiles.activeId()) ? '✔' : '';
        }

        /* ---------------- Sag panel ---------------- */

        function showSide(item) {
            U.empty(sideEl);
            if (!item) { return; }

            if (item.__add) {
                var e = U.el('div', 'empty');
                e.appendChild(U.el('div', 'empty__icon', '➕'));
                e.appendChild(U.el('div', 'empty__title', 'Yeni playlist ekle'));
                e.appendChild(U.el('div', 'empty__desc',
                    'Birden fazla hesap veya M3U listesi kaydedebilir, aralarinda ' +
                    'tek tusla gecis yapabilirsiniz. Kayitli playlistler televizyonda saklanir.'));
                sideEl.appendChild(e);
                return;
            }

            sideEl.appendChild(U.el('div', 'col__head', item.name));

            var info = {};
            info['Tur'] = item.type === 'xtream' ? 'Xtream Codes' : 'M3U Playlist';
            if (item.type === 'xtream') {
                info['Sunucu'] = item.host;
                info['Kullanici'] = item.username;
            } else {
                info['Adres'] = U.truncate(item.m3uUrl, 60);
                if (item.epgUrl) { info['EPG'] = U.truncate(item.epgUrl, 60); }
            }
            info['Eklendi'] = U.ddmmyyyy(new Date(item.createdAt));
            info['Durum'] = (item.id === App.Profiles.activeId()) ? 'Aktif' : 'Kayitli';

            if (item.id === App.Profiles.activeId()) {
                var ui = App.Profile.getUserInfo();
                if (ui && ui.expiresText) { info['Bitis'] = ui.expiresText; }
            }

            for (var k in info) {
                if (!Object.prototype.hasOwnProperty.call(info, k)) { continue; }
                var row = U.el('div', 'info-row');
                row.appendChild(U.el('span', 'info-row__k', k));
                row.appendChild(U.el('span', 'info-row__v', String(info[k])));
                sideEl.appendChild(row);
            }

            renderQr(item);
        }

        function renderQr(item) {
            var url = App.Profiles.shareUrl(item.id);

            var box = U.el('div', 'qr-box');
            sideEl.appendChild(box);

            if (!url) {
                box.appendChild(U.el('div', 't-sm', 'Bu playlist icin paylasilabilir adres uretilemedi.'));
                return;
            }

            box.appendChild(U.el('div', 'side__sec', 'Telefona Aktar'));

            var canvasWrap = U.el('div', 'qr-box__code');
            box.appendChild(canvasWrap);

            try {
                App.UI.QRCode.render(canvasWrap, url, {
                    size: U.rem(15),
                    level: 'L',          /* dusuk ECC -> uzun URL'de daha kucuk kod */
                    margin: 3
                });
            } catch (e) {
                log.warn('QR uretilemedi', e && e.message);
                U.empty(canvasWrap);
                canvasWrap.appendChild(U.el('div', 't-sm c-danger',
                    'Adres QR koda sigmayacak kadar uzun.'));
                return;
            }

            box.appendChild(U.el('div', 't-xs',
                'Telefonunuzun kamerasiyla okutun. Playlist adresi telefonunuza gecer; ' +
                'baska bir cihazda kullanmak veya yedeklemek icin kaydedebilirsiniz.'));
            box.appendChild(U.el('div', 't-xs c-gold',
                '⚠  Bu kod kullanici adinizi ve sifrenizi icerir. Baskalarina gostermeyin.'));
        }

        /* ---------------- Veri ---------------- */

        function reload(keepIndex) {
            var idx = keepIndex && list ? list.getIndex() : 0;
            rows = [{ __add: true }].concat(App.Profiles.list());
            headEl.textContent = 'PLAYLISTLER  (' + (rows.length - 1) + ')';
            list.setItems(rows, { index: Math.min(idx, rows.length - 1), silent: true,
                                  keepScroll: !!keepIndex });
            showSide(rows[Math.min(idx, rows.length - 1)]);
        }

        /* ---------------- Eylemler ---------------- */

        function onSelect(item) {
            if (item.__add) {
                App.Router.go('login', { mode: 'add' });
                return;
            }
            if (item.id === App.Profiles.activeId() && App.Content.sourceType()) {
                App.UI.Toast.info('Bu playlist zaten aktif');
                return;
            }
            activate(item);
        }

        function activate(item) {
            App.UI.Loading.show('"' + item.name + '" yukleniyor...', { delay: 0 });

            App.Profiles.setActive(item.id);
            App.EPG.clear();

            App.Content.init({
                onStatus: function (t) { App.UI.Loading.setProgress(t); }
            }).then(function () {
                if (App.Content.sourceType() !== 'xtream') { return null; }
                return App.Xtream.login().then(function (res) {
                    App.Profile.setUserInfo(res.userInfo);
                }, function (err) {
                    /* Dogrulama basarisiz olsa da onbellekten calisabiliriz */
                    log.warn('dogrulama basarisiz', App.AppError.wrap(err).code);
                    throw err;
                });
            }).then(function () {
                App.UI.Loading.hide(true);
                App.UI.Toast.success(item.name + ' etkinlestirildi');
                App.Router.reset('home');
            }, function (err) {
                App.UI.Loading.hide(true);
                var e = App.AppError.wrap(err);
                App.UI.Modal.choose('Playlist acilamadi', [
                    { label: 'Bilgileri duzenle', value: 'edit', icon: '✏' },
                    { label: 'Tekrar dene', value: 'retry', icon: '🔄' },
                    { label: 'Vazgec', value: 'cancel', icon: '✖' }
                ], { message: item.name + '\n\n' + e.message }).then(function (c) {
                    if (c === 'edit') { App.Router.go('login', { editId: item.id }); }
                    else if (c === 'retry') { activate(item); }
                    else { reload(true); }
                });
            });
        }

        function editCurrent() {
            var item = list.getItem();
            if (!item || item.__add) { return; }
            App.Router.go('login', { editId: item.id });
        }

        function deleteCurrent() {
            var item = list.getItem();
            if (!item || item.__add) { return; }

            App.UI.Modal.confirm('Playlist silinsin mi?',
                item.name + '\n\nBu playlistin kayitli bilgileri ve onbellegi silinecek.\n' +
                'Favorileriniz ve izleme gecmisiniz korunur.',
                { danger: true, okText: 'Sil' })
                .then(function (yes) {
                    if (!yes) { return; }
                    var wasActive = (item.id === App.Profiles.activeId());
                    App.Profiles.remove(item.id);
                    App.UI.Toast.info(item.name + ' silindi');

                    if (wasActive) {
                        var remaining = App.Profiles.list();
                        if (remaining.length) {
                            activate(remaining[0]);
                        } else {
                            App.Router.reset('login');
                        }
                        return;
                    }
                    reload(true);
                });
        }

        var onProfilesChange = function () { if (!destroyed) { reload(true); } };

        return {
            id: 'playlists',
            title: 'Playlistler',

            mount: function (container) {
                root = container;
                destroyed = false;

                var bar = U.el('div', 'topbar');
                bar.appendChild(U.el('div', 'topbar__title', '📄 Playlistlerim'));
                bar.appendChild(U.el('div', 'topbar__spacer'));
                root.appendChild(bar);

                var body = U.el('div', 'body');
                var cols = U.el('div', 'cols');

                var colL = U.el('div', 'col');
                colL.style.flex = '0 0 52rem';
                headEl = U.el('div', 'col__head', 'PLAYLISTLER');
                colL.appendChild(headEl);
                listHost = U.el('div', 'col__body');
                colL.appendChild(listHost);
                cols.appendChild(colL);

                var colR = U.el('div', 'col fill');
                colR.appendChild(U.el('div', 'col__head', 'BILGI'));
                var sideBody = U.el('div', 'col__body');
                sideEl = U.el('div', 'side');
                sideBody.appendChild(sideEl);
                colR.appendChild(sideBody);
                cols.appendChild(colR);

                body.appendChild(cols);
                root.appendChild(body);

                var hints = U.el('div', 'hintbar');
                hints.innerHTML =
                    '<span class="hint"><span class="hint__key">OK</span> Bu playliste gec</span>' +
                    '<span class="hint"><span class="hint__key">YESIL</span> Yeni ekle</span>' +
                    '<span class="hint"><span class="hint__key">SARI</span> Duzenle</span>' +
                    '<span class="hint"><span class="hint__key">KIRMIZI</span> Sil</span>' +
                    '<span class="hint"><span class="hint__key">RETURN</span> Geri</span>';
                root.appendChild(hints);

                list = App.UI.VirtualList.create({
                    container: listHost,
                    itemHeight: U.rem(6),
                    create: createRow,
                    update: updateRow,
                    onFocusChange: showSide,
                    onSelect: onSelect
                });

                App.Nav.bind(listHost, function () { list.select(); }, {
                    onFocus: function () { list.setActive(true); },
                    onBlur: function () { list.setActive(false); },
                    isDefault: true
                });

                App.Bus.on('profiles:change', onProfilesChange);

                reload(false);
                App.Nav.focus(listHost);
                list.setActive(true);
            },

            onResume: function () { reload(true); },

            onKey: function (code) {
                if (code === KEY.GREEN) { App.Router.go('login', { mode: 'add' }); return true; }
                if (code === KEY.YELLOW) { editCurrent(); return true; }
                if (code === KEY.RED) { deleteCurrent(); return true; }
                return false;
            },

            unmount: function () {
                destroyed = true;
                App.Bus.off('profiles:change', onProfilesChange);
                if (list) { list.destroy(); }
                list = null;
            }
        };
    };
})(window.App = window.App || {});
