/* ============================================================
   views/movies.js
   FILMLER (VOD)
     Sol  : kategori listesi
     Sag  : afis izgarasi (sanal izgara, sutun sayisi ekrana gore)

   OK  -> film detayi + oynatma secenekleri
   SARI-> favorilere ekle/cikar
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    var KEY = App.Keys.KEY;
    var log = App.Logger.get('Movies');

    App.Views = App.Views || {};

    App.Views.movies = function () {
        var root, catHost, gridHost, headEl;
        var catList = null, grid = null;
        var categories = [];
        var allMovies = [];     /* kategorinin TUM filmleri */
        var movies = [];        /* filtreden gecmis, EKRANDA gorunenler */
        var filterField = null;
        var chanTimer = null;
        var destroyed = false;

        var K_LAST_CAT = 'movies.lastCategory';

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
            r.bar = U.el('div', 'pbar');
            r.fill = U.el('div', 'pbar__fill');
            r.bar.appendChild(r.fill);
            r.bar.style.position = 'absolute';
            r.bar.style.left = '0';
            r.bar.style.right = '0';
            r.bar.style.bottom = U.rem(3.5) + 'px';   /* .poster__cap yuksekligi */
            p.appendChild(r.bar);
            node.appendChild(p);
        }

        function updatePoster(node, item) {
            var r = node.__r;
            r.cap.textContent = item.name;

            var badge = App.Favorites.has(item) ? '★' : (item.rating ? ('★ ' + item.rating) : '');
            r.badge.textContent = badge;
            r.badge.style.display = badge ? '' : 'none';

            var prog = App.History.progressOf(item.key);
            r.bar.style.display = prog > 0.02 ? '' : 'none';
            r.fill.style.width = Math.round(prog * 100) + '%';

            App.UI.ImageLoader.into(r.img, item.logo, '🎬');
        }

        /* ---------------- Veri ---------------- */

        function loadCategories() {
            return App.Content.getMovieCategories().then(function (cats) {
                categories = cats.slice();
                categories.splice(1, 0, { id: App.Content.FAV_ID, name: '★ Favori Filmler' });
                catList.setItems(categories, { silent: true });

                var lastId = App.Storage.get(K_LAST_CAT, null);
                var start = 0;
                if (lastId) {
                    for (var i = 0; i < categories.length; i++) {
                        if (categories[i].id === lastId) { start = i; break; }
                    }
                }
                catList.setIndex(start, { silent: true });
                return loadMovies(categories[start]);
            });
        }

        function loadMovies(cat) {
            if (!cat) { return Promise.resolve(); }
            App.Storage.trySet(K_LAST_CAT, cat.id);
            headEl.textContent = 'FILMLER  —  ' + cat.name;
            App.UI.ImageLoader.flush();

            if (cat.id === App.Content.FAV_ID) {
                allMovies = App.Favorites.list('movie');
                applyFilter();
                return Promise.resolve();
            }

            headEl.textContent += '  •  yukleniyor...';

            return App.Content.getMovies(cat.id).then(function (list) {
                if (destroyed) { return; }
                allMovies = list || [];
                applyFilter();
            }, function (err) {
                if (destroyed) { return; }
                var e = App.AppError.wrap(err);
                log.error('film listesi', e.code, e.detail);
                allMovies = [];
                movies = [];
                grid.setItems([], { emptyText: e.message.split('\n')[0], emptyIcon: '⚠' });
                App.UI.Toast.fromError(e, 'Filmler yuklenemedi:');
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
                movies = allMovies.slice();
            } else {
                movies = [];
                for (var i = 0; i < allMovies.length; i++) {
                    if (U.normalize(allMovies[i].name).indexOf(q) !== -1) {
                        movies.push(allMovies[i]);
                    }
                }
            }

            grid.setItems(movies, {
                emptyText: q ? ('"' + raw + '" icin sonuc bulunamadi') : 'Bu kategoride film yok',
                emptyIcon: q ? '🔍' : '📭'
            });

            var cat = catList && catList.getItem();
            headEl.textContent = 'FILMLER  —  ' + ((cat && cat.name) || '') +
                '  (' + movies.length + (q ? (' / ' + allMovies.length) : '') + ')';
        }


        function onCategoryFocus(cat) {
            if (chanTimer) { clearTimeout(chanTimer); }
            chanTimer = setTimeout(function () {
                if (!destroyed) { loadMovies(cat); }
            }, 260);
        }

        /* ---------------- Eylemler ---------------- */

        function openMovie(item, index) {
            App.UI.Loading.show('Film bilgileri aliniyor...');
            App.Content.getMovieInfo(item).then(function (info) {
                App.UI.Loading.hide();
                showMovieSheet(item, info, index);
            }, function () {
                App.UI.Loading.hide();
                /* Detay alinamasa bile oynatabilelim */
                showMovieSheet(item, null, index);
            });
        }

        function showMovieSheet(item, info, index) {
            var resumeSec = App.History.resumeOf(item.key);
            var opts = [];

            if (resumeSec > 0) {
                opts.push({
                    label: 'Kaldigin yerden devam et  (' + U.duration(resumeSec) + ')',
                    value: 'resume', icon: '▶'
                });
                opts.push({ label: 'Bastan oynat', value: 'play', icon: '⏮' });
            } else {
                opts.push({ label: 'Oynat', value: 'play', icon: '▶' });
            }

            opts.push({
                label: App.Favorites.has(item) ? 'Favorilerden cikar' : 'Favorilere ekle',
                value: 'fav', icon: '★'
            });

            var lines = [];
            if (info) {
                if (info.releaseDate) { lines.push('Yil: ' + String(info.releaseDate).substr(0, 4)); }
                if (info.genre) { lines.push('Tur: ' + info.genre); }
                if (info.duration) { lines.push('Sure: ' + info.duration); }
                else if (info.durationSecs) { lines.push('Sure: ' + U.duration(info.durationSecs)); }
                if (info.rating) { lines.push('Puan: ' + info.rating); }
                if (info.director) { lines.push('Yonetmen: ' + info.director); }
                if (info.cast) { lines.push('Oyuncular: ' + U.truncate(info.cast, 120)); }
                if (info.plot) { lines.push('\n' + U.truncate(info.plot, 340)); }
            }

            App.UI.Modal.choose(item.name, opts, {
                message: lines.join('\n')
            }).then(function (choice) {
                if (choice === 'fav') {
                    App.Favorites.toggle(item);
                    grid.refreshIndex(index);
                    return;
                }
                if (choice === 'play' || choice === 'resume') {
                    if (info && info.containerExtension) {
                        item.containerExtension = info.containerExtension;
                    }
                    App.Router.go('player', {
                        item: item,
                        context: { items: movies, index: index },
                        startMs: choice === 'play' ? 0 : (resumeSec * 1000),
                        returnTo: 'movies'
                    });
                }
            });
        }

        function toggleFav() {
            var item = grid && grid.getItem();
            if (!item) { return; }
            var on = App.Favorites.toggle(item);
            App.UI.Toast.info(on ? '★ Favorilere eklendi' : 'Favorilerden cikarildi');
            grid.refreshIndex(grid.getIndex());
            var cat = catList.getItem();
            if (cat && cat.id === App.Content.FAV_ID && !on) { loadMovies(cat); }
        }

        return {
            id: 'movies',
            title: 'Filmler',

            mount: function (container) {
                root = container;
                destroyed = false;

                var bar = U.el('div', 'topbar');
                bar.appendChild(U.el('div', 'topbar__title', '🎬 Filmler'));
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
                headEl = U.el('span', 'col__title', 'FILMLER');
                head.appendChild(headEl);

                var filterWrap = U.el('div', 'col__tool');
                filterField = App.UI.Field.create({
                    placeholder: '🔍  Bu kategoride film ara...',
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
                    '<span class="hint"><span class="hint__key">OK</span> Detay / Oynat</span>' +
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

                /* Afis boyutu kapsayiciya gore hesaplanir (tam iki satir
                   sigar) -> 1080p ve 4K'da ayni gorunum */
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
                    onSelect: openMovie,
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
                App.UI.Loading.show('Film kategorileri yukleniyor...');
                loadCategories().then(function () {
                    App.UI.Loading.hide();
                    if (destroyed) { return; }
                    App.Nav.focus(gridHost);
                    grid.setActive(true);
                }, function (err) {
                    App.UI.Loading.hide();
                    if (destroyed) { return; }
                    var e = App.AppError.wrap(err);
                    App.UI.Modal.alert('Filmler yuklenemedi', e.message)
                        .then(function () { App.Router.back(); });
                });
            },

            onResume: function () { if (grid) { grid.refresh(); } },

            onKey: function (code) {
                if (code === KEY.YELLOW) { toggleFav(); return true; }
                if (code === KEY.SEARCH) { App.Router.go('search', { scope: 'movie' }); return true; }
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
