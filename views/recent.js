/* ============================================================
   views/recent.js
   SON IZLENENLER
   Tek listede en son izlenenden en eskiye dogru siralanir.
   Film ve bolumlerde izleme yuzdesi ve "kaldigin yer" gosterilir.

   OK   -> devam et / oynat
   SARI -> kayittan sil
   MAVI -> gecmisi tamamen temizle
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    var KEY = App.Keys.KEY;

    App.Views = App.Views || {};

    App.Views.recent = function () {
        var root, listHost, headEl;
        var list = null;
        var items = [];

        function timeAgo(ts) {
            var diff = Date.now() - (ts || 0);
            var min = Math.floor(diff / 60000);
            if (min < 1) { return 'az once'; }
            if (min < 60) { return min + ' dk once'; }
            var h = Math.floor(min / 60);
            if (h < 24) { return h + ' saat once'; }
            var d = Math.floor(h / 24);
            if (d < 7) { return d + ' gun once'; }
            return U.ddmmyyyy(new Date(ts));
        }

        function renderItem(node, item) {
            U.empty(node);
            node.style.height = U.rem(6) + 'px';

            node.appendChild(U.el('span', 'ch__num', App.Actions.typeGlyph(item.type)));

            var logo = U.el('div', 'ch__logo');
            node.appendChild(logo);
            App.UI.ImageLoader.into(logo, item.logo, U.initials(item.name));

            var texts = U.el('div', 'ch__texts');
            texts.appendChild(U.el('div', 'ch__name', item.name));

            var sub = [App.Actions.typeName(item.type), timeAgo(item.watchedAt)];
            if (item.type === 'episode' && item.season) {
                sub.splice(1, 0, 'S' + U.pad2(item.season) + 'B' + U.pad2(item.episodeNum));
            }
            if (item.type !== 'live' && item.position > 0 && item.duration > 0) {
                sub.push(U.duration(item.position) + ' / ' + U.duration(item.duration));
            }
            texts.appendChild(U.el('div', 'ch__epg', sub.join('  •  ')));

            if (item.type !== 'live' && item.duration > 0 && item.position > 0) {
                var bar = U.el('div', 'pbar');
                bar.style.marginTop = '.35rem';
                var fill = U.el('div', 'pbar__fill');
                fill.style.width = Math.min(100, Math.round(item.position * 100 / item.duration)) + '%';
                bar.appendChild(fill);
                texts.appendChild(bar);
            }

            node.appendChild(texts);
            if (App.Favorites.has(item)) { node.appendChild(U.el('span', 'ch__fav', '★')); }
        }

        function reload() {
            items = App.History.list();
            headEl.textContent = 'SON IZLENENLER  (' + items.length + ')';
            App.UI.ImageLoader.flush();
            list.setItems(items, {
                emptyText: 'Henuz bir sey izlemediniz',
                emptyIcon: '🕒'
            });
        }

        function openCurrent(item, index) {
            App.Actions.open(item, { items: items, index: index, returnTo: 'recent' });
        }

        return {
            id: 'recent',
            title: 'Son Izlenenler',

            mount: function (container) {
                root = container;

                var bar = U.el('div', 'topbar');
                bar.appendChild(U.el('div', 'topbar__title', '🕒 Son Izlenenler'));
                bar.appendChild(U.el('div', 'topbar__spacer'));
                root.appendChild(bar);

                var body = U.el('div', 'body');
                var col = U.el('div', 'col fill');
                headEl = U.el('div', 'col__head', 'SON IZLENENLER');
                col.appendChild(headEl);
                listHost = U.el('div', 'col__body');
                col.appendChild(listHost);
                body.appendChild(col);
                root.appendChild(body);

                var hints = U.el('div', 'hintbar');
                hints.innerHTML =
                    '<span class="hint"><span class="hint__key">OK</span> Devam et</span>' +
                    '<span class="hint"><span class="hint__key">SARI</span> Kayittan sil</span>' +
                    '<span class="hint"><span class="hint__key">MAVI</span> Gecmisi temizle</span>' +
                    '<span class="hint"><span class="hint__key">RETURN</span> Geri</span>';
                root.appendChild(hints);

                list = App.UI.VirtualList.create({
                    container: listHost,
                    itemHeight: U.rem(6),
                    render: renderItem,
                    onSelect: openCurrent
                });

                App.Nav.bind(listHost, function () { list.select(); }, {
                    onFocus: function () { list.setActive(true); },
                    onBlur: function () { list.setActive(false); },
                    isDefault: true
                });

                reload();
                App.Nav.focus(listHost);
                list.setActive(true);
            },

            onResume: reload,

            onKey: function (code) {
                if (code === KEY.YELLOW) {
                    var item = list.getItem();
                    if (!item) { return true; }
                    App.History.remove(item.key);
                    reload();
                    App.UI.Toast.info('Kayittan silindi');
                    return true;
                }
                if (code === KEY.BLUE) {
                    App.UI.Modal.confirm('Izleme gecmisi silinsin mi?',
                        'Kaldiginiz yer bilgileri de silinecek.', { danger: true, okText: 'Sil' })
                        .then(function (yes) {
                            if (!yes) { return; }
                            App.History.clear();
                            reload();
                            App.UI.Toast.success('Gecmis temizlendi');
                        });
                    return true;
                }
                return false;
            },

            unmount: function () {
                App.UI.ImageLoader.flush();
                if (list) { list.destroy(); }
                list = null;
            }
        };
    };
})(window.App = window.App || {});
