/* ============================================================
   views/series.js
   DIZILER
     Sol : kategori listesi
     Sag : dizi afis izgarasi
   OK -> views/seriesDetail.js (sezon ve bolum listesi)

   NOT: Dizi destegi yalnizca Xtream Codes kaynaklarinda vardir
   (M3U playlist'lerde sezon/bolum yapisi bulunmaz).
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    var KEY = App.Keys.KEY;
    var log = App.Logger.get('Series');

    App.Views = App.Views || {};

    App.Views.series = function () {
        var root, catHost, gridHost, headEl;
        var catList = null, grid = null;
        var categories = [];
        var allItems = [];      /* kategorinin TUM dizileri */
        var items = [];         /* filtreden gecmis, EKRANDA gorunenler */
        var filterField = null;
        var chanTimer = null;
        var destroyed = false;

        var K_LAST_CAT = 'series.lastCategory';

        /* ISKELET DESENI (performans):
           Satirin DOM yapisi HAVUZ OGESI BASINA BIR KEZ kurulur; kaydirma
           sirasinda yalnizca metin/gorsel guncellenir. Onceki surumde her
           satir her kaydirma adiminda sifirdan yeniden olusturuluyordu ve
           bu, TV'de gozle gorulur kasmaya yol aciyordu. */

        function createCategory(node) {
            node.style.height = U.rem(4.5) + 'px';
            var r = node.__r = {
                name: U.el('span', 'cat__name'),
                count: U.el('span', 'cat__count')
            };
            node.appendChild(r.name);
            node.appendChild(r.count);
        }

        function updateCategory(node, item) {
            var r = node.__r;
            r.name.textContent = item.name;
            r.count.textContent = item.count ? item.count : '';
        }

        function createPoster(node) {
            var p = U.el('div', 'poster');
            var r = node.__r = {
                img: U.el('div', 'poster__img'),
                cap: U.el('div', 'poster__cap clamp-2'),
                badge: U.el('div', 'poster__badge')
            };
            p.appendChild(r.img);
            p.appendChild(r.cap);
            p.appendChild(r.badge);
            node.appendChild(p);
        }

        function updatePoster(node, item) {
            var r = node.__r;
            r.cap.textContent = item.name;

            var badge = App.Favorites.has(item) ? '★' : (item.rating ? ('★ ' + item.rating) : '');
            r.badge.textContent = badge;
            r.badge.style.display = badge ? '' : 'none';

            App.UI.ImageLoader.into(r.img, item.logo, '📺');
        }

        function loadCategories() {
            return App.Content.getSeriesCategories().then(function (cats) {
                categories = cats.slice();
                categories.splice(1, 0, { id: App.Content.FAV_ID, name: '★ Favori Diziler' });
                catList.setItems(categories, { silent: true });

                var lastId = App.Storage.get(K_LAST_CAT, null);
                var start = 0;
                if (lastId) {
                    for (var i = 0; i < categories.length; i++) {
                        if (categories[i].id === lastId) { start = i; break; }
                    }
                }
                catList.setIndex(start, { silent: true });
                return loadSeries(categories[start]);
            });
        }

        function loadSeries(cat) {
            if (!cat) { return Promise.resolve(); }
            App.Storage.trySet(K_LAST_CAT, cat.id);
            headEl.textContent = 'DIZILER  —  ' + cat.name;
            App.UI.ImageLoader.flush();

            if (cat.id === App.Content.FAV_ID) {
                allItems = App.Favorites.list('series');
                applyFilter();
                return Promise.resolve();
            }

            headEl.textContent += '  •  yukleniyor...';

            return App.Content.getSeriesList(cat.id).then(function (list) {
                if (destroyed) { return; }
                allItems = list || [];
                applyFilter();
            }, function (err) {
                if (destroyed) { return; }
                var e = App.AppError.wrap(err);
                log.error('dizi listesi', e.code, e.detail);
                allItems = [];
                items = [];
                grid.setItems([], { emptyText: e.message.split('\n')[0], emptyIcon: '⚠' });
                App.UI.Toast.fromError(e, 'Diziler yuklenemedi:');
            });
        }

        /**
         * Arama kutusuna gore suzer. Turkce karakter duyarsizdir.
         * Oynatici baglami EKRANDA GORUNEN listedir.
         */
        function applyFilter() {
            var raw = filterField ? filterField.getValue() : '';
            var q = U.normalize(raw);

            if (!q) {
                items = allItems.slice();
            } else {
                items = [];
                for (var i = 0; i < allItems.length; i++) {
                    if (U.normalize(allItems[i].name).indexOf(q) !== -1) {
                        items.push(allItems[i]);
                    }
                }
            }

            grid.setItems(items, {
                emptyText: q ? ('"' + raw + '" icin sonuc bulunamadi') : 'Bu kategoride dizi yok',
                emptyIcon: q ? '🔍' : '📭'
            });

            var cat = catList && catList.getItem();
            headEl.textContent = 'DIZILER  —  ' + ((cat && cat.name) || '') +
                '  (' + items.length + (q ? (' / ' + allItems.length) : '') + ')';
        }


        function onCategoryFocus(cat) {
            if (chanTimer) { clearTimeout(chanTimer); }
            chanTimer = setTimeout(function () {
                if (!destroyed) { loadSeries(cat); }
            }, 260);
        }

        function openSeries(item) {
            App.Router.go('seriesDetail', { series: item });
        }

        function toggleFav() {
            var item = grid && grid.getItem();
            if (!item) { return; }
            var on = App.Favorites.toggle(item);
            App.UI.Toast.info(on ? '★ Favorilere eklendi' : 'Favorilerden cikarildi');
            grid.refreshIndex(grid.getIndex());
            var cat = catList.getItem();
            if (cat && cat.id === App.Content.FAV_ID && !on) { loadSeries(cat); }
        }

        return {
            id: 'series',
            title: 'Diziler',

            mount: function (container) {
                root = container;
                destroyed = false;

                var bar = U.el('div', 'topbar');
                bar.appendChild(U.el('div', 'topbar__title', '📺 Diziler'));
                bar.appendChild(U.el('div', 'topbar__spacer'));
                root.appendChild(bar);

                var body = U.el('div', 'body');
                var cols = U.el('div', 'cols');

                var colCat = U.el('div', 'col col--cats');
                colCat.appendChild(U.el('div', 'col__head', 'KATEGORILER'));
                catHost = U.el('div', 'col__body');
                colCat.appendChild(catHost);
                cols.appendChild(colCat);

                var colGrid = U.el('div', 'col fill');
                var head = U.el('div', 'col__head');
                headEl = U.el('span', 'col__title', 'DIZILER');
                head.appendChild(headEl);

                var filterWrap = U.el('div', 'col__tool');
                filterField = App.UI.Field.create({
                    placeholder: '🔍  Bu kategoride dizi ara...',
                    onChange: function () { applyFilter(); },
                    onSubmit: function () {
                        applyFilter();
                        App.Nav.focus(gridHost);
                    }
                });
                filterWrap.appendChild(filterField.root);
                head.appendChild(filterWrap);
                colGrid.appendChild(head);

                gridHost = U.el('div', 'col__body col__body--bare');
                colGrid.appendChild(gridHost);
                cols.appendChild(colGrid);

                body.appendChild(cols);
                root.appendChild(body);

                var hints = U.el('div', 'hintbar');
                hints.innerHTML =
                    '<span class="hint"><span class="hint__key">OK</span> Sezon / Bolumler</span>' +
                    '<span class="hint"><span class="hint__key">SARI</span> Favori</span>' +
                    '<span class="hint"><span class="hint__key">▲</span> Kategoride ara</span>' +
                    '<span class="hint"><span class="hint__key">RETURN</span> Geri</span>';
                root.appendChild(hints);

                catList = App.UI.VirtualList.create({
                    container: catHost,
                    itemHeight: U.rem(4.5),
                    create: createCategory,
                    update: updateCategory,
                    onFocusChange: onCategoryFocus,
                    onSelect: function () { App.Nav.focus(gridHost); },
                    onEdge: function (dir) {
                        if (dir === 'right') { App.Nav.focus(gridHost); return true; }
                        return false;
                    }
                });

                var gs = App.UI.VirtualList.posterGrid(gridHost);

                grid = App.UI.VirtualList.create({
                    container: gridHost,
                    itemHeight: gs.itemHeight,
                    columns: gs.columns,
                    gapX: gs.gapX,
                    gapY: gs.gapY,
                    itemClass: 'grid__item',
                    create: createPoster,
                    update: updatePoster,
                    onSelect: openSeries,
                    onEdge: function (dir) {
                        if (dir === 'left') { App.Nav.focus(catHost); return true; }
                        if (dir === 'up') { filterField.focusBox(); return true; }
                        return true;
                    }
                });

                App.Nav.bind(catHost, function () { catList.select(); }, {
                    onFocus: function () { catList.setActive(true); },
                    onBlur: function () { catList.setActive(false); }
                });
                App.Nav.bind(gridHost, function () { grid.select(); }, {
                    onFocus: function () { grid.setActive(true); },
                    onBlur: function () { grid.setActive(false); },
                    isDefault: true
                });

                /* Veri yuklemesi router gecisini BLOKLAMAZ: ekran hemen acilir,
                   liste "Yukleniyor..." gosterir. Boylece yavas bir sunucuda
                   kullanici RETURN ile hemen geri donebilir. */
                App.Nav.focus(gridHost);
                App.UI.Loading.show('Dizi kategorileri yukleniyor...');
                loadCategories().then(function () {
                    App.UI.Loading.hide();
                    if (destroyed) { return; }
                    App.Nav.focus(gridHost);
                    grid.setActive(true);
                }, function (err) {
                    App.UI.Loading.hide();
                    if (destroyed) { return; }
                    var e = App.AppError.wrap(err);
                    App.UI.Modal.alert('Diziler yuklenemedi', e.message)
                        .then(function () { App.Router.back(); });
                });
            },

            onResume: function () { if (grid) { grid.refresh(); } },

            onKey: function (code) {
                if (code === KEY.YELLOW) { toggleFav(); return true; }
                if (code === KEY.SEARCH) { App.Router.go('search', { scope: 'series' }); return true; }
                return false;
            },

            onBack: function () {
                if (App.Nav.get() === gridHost && catList && catList.count() > 1) {
                    App.Nav.focus(catHost);
                    return true;
                }
                return false;
            },

            unmount: function () {
                destroyed = true;
                if (chanTimer) { clearTimeout(chanTimer); }
                App.UI.ImageLoader.flush();
                if (catList) { catList.destroy(); }
                if (grid) { grid.destroy(); }
                catList = grid = null;
                filterField = null;
            }
        };
    };
})(window.App = window.App || {});
