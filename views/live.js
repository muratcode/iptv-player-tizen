/* ============================================================
   views/live.js
   CANLI TV
     Sol   : kategori listesi
     Orta  : kanal listesi (sanal liste - binlerce kanal sorunsuz)
     Sag   : secili kanalin logosu + EPG (simdiki/sonraki program)

   Kumanda:
     ▲ ▼      liste icinde gezin
     ◀ ▶      kolonlar arasi gecis
     OK       kanali tam ekran ac
     SARI     favorilere ekle/cikar
     MAVI     favori kanallari goster/gizle
     0-9      kanal numarasi ile hizli gecis
     CH+/CH-  sayfa atlama
     RETURN   ana ekrana don
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    var KEY = App.Keys.KEY;
    var log = App.Logger.get('Live');

    App.Views = App.Views || {};

    App.Views.live = function () {
        var root, catHost, chHost, sideEl, chHeadEl;
        var catList = null, chList = null;
        var categories = [];
        var allChannels = [];   /* kategorinin TUM kanallari */
        var channels = [];      /* filtreden gecmis, EKRANDA gorunenler */
        var filterField = null;
        var favOnly = false;
        var epgTimer = null, chanTimer = null;
        var loadedCatId = null;      /* ayni kategoriyi iki kez yuklemeyi onler */
        var numBuffer = '', numTimer = null, numEl = null;
        var destroyed = false;

        var K_LAST_CAT = 'live.lastCategory';

        /* ---------------- Kategori satiri ---------------- */
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

        /* ---------------- Kanal satiri ---------------- */
        function createChannel(node) {
            node.style.height = U.rem(5.5) + 'px';
            var texts = U.el('div', 'ch__texts');
            var r = node.__r = {
                num: U.el('span', 'ch__num'),
                logo: U.el('div', 'ch__logo'),
                name: U.el('div', 'ch__name'),
                epg: U.el('div', 'ch__epg'),
                fav: U.el('span', 'ch__fav')
            };
            texts.appendChild(r.name);
            texts.appendChild(r.epg);
            node.appendChild(r.num);
            node.appendChild(r.logo);
            node.appendChild(texts);
            node.appendChild(r.fav);
        }

        function updateChannel(node, item) {
            var r = node.__r;
            var showNum = App.Settings.get('showChannelNumbers');
            r.num.style.display = showNum ? '' : 'none';
            r.num.textContent = showNum ? (item.num || '') : '';
            r.name.textContent = item.name;

            /* Bellekte XMLTV varsa satirda da program adini goster (ag istegi yok) */
            var nn = App.EPG.fromIndex(item.epgChannelId);
            r.epg.textContent = (nn && nn.now) ? nn.now.title : '';

            r.fav.textContent = App.Favorites.has(item) ? '★' : '';
            App.UI.ImageLoader.into(r.logo, item.logo, U.initials(item.name));
        }

        /* ---------------- Sag panel ---------------- */
        function renderSide(item) {
            U.empty(sideEl);
            if (!item) {
                sideEl.appendChild(U.el('div', 'empty__desc', 'Kanal secin'));
                return;
            }

            var logoBox = U.el('div', 'side__logo');
            sideEl.appendChild(logoBox);
            App.UI.ImageLoader.into(logoBox, item.logo, U.initials(item.name));

            sideEl.appendChild(U.el('div', 'side__name', item.name));

            var catName = '';
            for (var i = 0; i < categories.length; i++) {
                if (categories[i].id === item.categoryId) { catName = categories[i].name; }
            }
            sideEl.appendChild(U.el('div', 'side__cat',
                (item.num ? ('Kanal ' + item.num + '  •  ') : '') + (catName || '')));

            var epgWrap = U.el('div', '');
            epgWrap.setAttribute('data-epg', '1');
            epgWrap.appendChild(U.el('div', 'side__sec', 'Program Rehberi'));
            epgWrap.appendChild(U.el('div', 'side__prog', 'Yukleniyor...'));
            sideEl.appendChild(epgWrap);

            if (App.Favorites.has(item)) {
                var fav = U.el('div', 'badge badge--ok', '★ Favorilerde');
                fav.style.marginTop = '1rem';
                sideEl.appendChild(fav);
            }
        }

        function renderEpgInto(wrap, nn) {
            U.empty(wrap);
            wrap.appendChild(U.el('div', 'side__sec', 'Simdi'));

            if (!nn || !nn.now) {
                wrap.appendChild(U.el('div', 'side__prog c-mute', 'Program bilgisi bulunamadi'));
            } else {
                wrap.appendChild(U.el('div', 'side__prog', nn.now.title));
                wrap.appendChild(U.el('div', 'side__time', App.EPG.timeRange(nn.now)));

                var pct = App.EPG.progressOf(nn.now);
                if (pct > 0) {
                    var bar = U.el('div', 'pbar side__prog-bar');
                    var fill = U.el('div', 'pbar__fill');
                    fill.style.width = Math.round(pct * 100) + '%';
                    bar.appendChild(fill);
                    wrap.appendChild(bar);
                }
                if (nn.now.desc) {
                    wrap.appendChild(U.el('div', 'side__desc clamp-4', nn.now.desc));
                }
            }

            if (nn && nn.next) {
                wrap.appendChild(U.el('div', 'side__sec', 'Sonraki'));
                wrap.appendChild(U.el('div', 'side__next', nn.next.title));
                wrap.appendChild(U.el('div', 'side__time', App.EPG.timeRange(nn.next)));
            }
        }

        function loadEpgFor(item) {
            if (epgTimer) { clearTimeout(epgTimer); }
            if (!item) { return; }

            /* Kullanici listede hizli gezerken her satirda istek atmayalim */
            epgTimer = setTimeout(function () {
                if (destroyed) { return; }
                var target = chList && chList.getItem();
                if (!target || target.key !== item.key) { return; }

                App.EPG.forChannel(item).then(function (nn) {
                    if (destroyed) { return; }
                    var cur = chList && chList.getItem();
                    if (!cur || cur.key !== item.key) { return; }
                    var wrap = sideEl.querySelector('[data-epg]');
                    if (wrap) { renderEpgInto(wrap, nn); }
                });
            }, 380);
        }

        /* ---------------- Veri yukleme ---------------- */

        function loadCategories() {
            return App.Content.getLiveCategories().then(function (cats) {
                categories = cats.slice();
                /* Favoriler sanal kategorisi */
                /* "Tum Kanallar" ilk sirada kalmali; Favoriler onun ARDINA eklenir.
                   Aksi halde uygulamayi ilk acan kullanici bos bir liste gorur. */
                categories.splice(1, 0, { id: App.Content.FAV_ID, name: '★ Favoriler' });
                catList.setItems(categories, { silent: true });

                var lastId = App.Storage.get(K_LAST_CAT, null);
                var startIdx = 0;
                if (lastId) {
                    for (var i = 0; i < categories.length; i++) {
                        if (categories[i].id === lastId) { startIdx = i; break; }
                    }
                }
                catList.setIndex(startIdx, { silent: true });
                return loadChannels(categories[startIdx]);
            });
        }

        function loadChannels(cat) {
            if (!cat) { return Promise.resolve(); }
            App.Storage.trySet(K_LAST_CAT, cat.id);
            loadedCatId = cat.id;
            chHeadEl.textContent = 'Kanallar  —  ' + cat.name;

            App.UI.ImageLoader.flush();

            if (cat.id === App.Content.FAV_ID) {
                allChannels = App.Favorites.list('live');
                applyFilter();
                return Promise.resolve();
            }

            /* ONEMLI: Liste BOSALTILMAZ.
               Onceden her kategori degisiminde liste once bosaltilip
               "Yukleniyor..." gosteriliyordu; bu, hizli gezinirken
               titremeye ve odagin kaybolmasina yol aciyordu. Artik eski
               icerik yerinde kalir, yalnizca baslikta durum belirtilir. */
            chHeadEl.textContent += '  •  yukleniyor...';

            return App.Content.getLiveChannels(cat.id).then(function (list) {
                if (destroyed) { return; }
                allChannels = list || [];
                applyFilter();
            }, function (err) {
                if (destroyed) { return; }
                var e = App.AppError.wrap(err);
                log.error('kanal listesi', e.code, e.detail);
                loadedCatId = null;      /* tekrar denenebilsin */
                allChannels = [];
                channels = [];
                chList.setItems([], {
                    emptyText: e.message.split('\n')[0],
                    emptyIcon: '⚠'
                });
                App.UI.Toast.fromError(e, 'Kanallar yuklenemedi:');
            });
        }

        /**
         * Arama kutusundaki metne gore kanallari suzer ve listeyi tazeler.
         * Turkce karakter duyarsizdir: "guclu" ile "GÜÇLÜ" eslesir.
         * Oynatici baglami da (kanal degistirme) EKRANDA GORUNEN listedir.
         */
        function applyFilter() {
            var raw = filterField ? filterField.getValue() : '';
            var q = U.normalize(raw);

            if (!q) {
                channels = allChannels.slice();
            } else {
                channels = [];
                for (var i = 0; i < allChannels.length; i++) {
                    if (U.normalize(allChannels[i].name).indexOf(q) !== -1) {
                        channels.push(allChannels[i]);
                    }
                }
            }

            chList.setItems(channels, {
                emptyText: q ? ('"' + raw + '" icin kanal bulunamadi') : 'Bu kategoride kanal yok',
                emptyIcon: q ? '🔍' : '📭'
            });

            var cat = catList && catList.getItem();
            chHeadEl.textContent = 'Kanallar  —  ' + ((cat && cat.name) || '') +
                '  (' + channels.length + (q ? (' / ' + allChannels.length) : '') + ')';

            var cur = chList.getItem();
            renderSide(cur);
            loadEpgFor(cur);
        }

        /* Kategori odagi degisince kanallari getir (gecikmeli).
           Gecikme, kullanici kategoriler arasinda hizlica gezerken her
           satirda ag istegi acilmasini onler. */
        function onCategoryFocus(cat) {
            if (chanTimer) { clearTimeout(chanTimer); }
            if (!cat || cat.id === loadedCatId) { return; }
            chanTimer = setTimeout(function () {
                chanTimer = null;
                if (!destroyed) { loadChannels(cat); }
            }, 260);
        }

        /* Kategoride OK'a basildi: bekleyen gecikmeyi iptal edip HEMEN yukle,
           sonra kanal kolonuna gec. */
        function selectCategory(cat) {
            if (chanTimer) { clearTimeout(chanTimer); chanTimer = null; }
            var p = (cat && cat.id !== loadedCatId) ? loadChannels(cat) : Promise.resolve();
            App.Nav.focus(chHost);
            return p;
        }

        /* ---------------- Eylemler ---------------- */

        function openChannel(item, index) {
            if (!item) { return; }
            App.Router.go('player', {
                item: item,
                context: { items: channels, index: index },
                returnTo: 'live'
            });
        }

        function toggleFav() {
            var item = chList && chList.getItem();
            if (!item) { return; }
            var on = App.Favorites.toggle(item);
            App.UI.Toast.info(on ? ('★ ' + item.name + ' favorilere eklendi')
                                 : (item.name + ' favorilerden cikarildi'));
            chList.refreshIndex(chList.getIndex());
            renderSide(item);
            loadEpgFor(item);

            /* Favoriler kategorisindeysek listeden dus */
            var cat = catList.getItem();
            if (cat && cat.id === App.Content.FAV_ID && !on) { loadChannels(cat); }
        }

        /* Sayi tuslariyla kanal numarasina atlama */
        function pushNumber(digit) {
            numBuffer += String(digit);
            if (numBuffer.length > 4) { numBuffer = numBuffer.substr(-4); }

            if (!numEl) {
                numEl = U.el('div', 'numpad');
                root.appendChild(numEl);
            }
            numEl.textContent = numBuffer;
            numEl.classList.remove('hidden');

            if (numTimer) { clearTimeout(numTimer); }
            numTimer = setTimeout(function () {
                var n = U.toInt(numBuffer, -1);
                numBuffer = '';
                if (numEl) { numEl.classList.add('hidden'); }
                if (n < 0) { return; }

                var found = chList.jumpTo(function (it) { return U.toInt(it.num, -1) === n; });
                if (found === -1 && n >= 1 && n <= channels.length) {
                    chList.setIndex(n - 1, { jump: true });
                    found = n - 1;
                }
                if (found === -1) { App.UI.Toast.warn(n + ' numarali kanal bulunamadi'); }
                else { App.Nav.focus(chHost); }
            }, 1200);
        }

        var onFavChange = function () {
            if (chList) { chList.refresh(); }
        };

        return {
            id: 'live',
            title: 'Canli TV',

            mount: function (container) {
                root = container;
                destroyed = false;

                /* --- Ust bar --- */
                var bar = U.el('div', 'topbar');
                bar.appendChild(U.el('div', 'topbar__title', '📡 Canli TV'));
                bar.appendChild(U.el('div', 'topbar__spacer'));
                var meta = U.el('div', 'topbar__meta');
                meta.appendChild(U.el('span', 'topbar__clock', U.hhmm(new Date())));
                bar.appendChild(meta);
                root.appendChild(bar);

                /* --- Uc kolon --- */
                var body = U.el('div', 'body');
                var cols = U.el('div', 'cols');

                /* Kategoriler */
                var colCat = U.el('div', 'col col--cats');
                colCat.appendChild(U.el('div', 'col__head', 'KATEGORILER'));
                catHost = U.el('div', 'col__body');
                colCat.appendChild(catHost);
                cols.appendChild(colCat);

                /* Kanallar (+ kolon ici arama) */
                var colCh = U.el('div', 'col col--channels');
                var chHead = U.el('div', 'col__head');
                chHeadEl = U.el('span', 'col__title', 'KANALLAR');
                chHead.appendChild(chHeadEl);

                var filterWrap = U.el('div', 'col__tool');
                filterField = App.UI.Field.create({
                    placeholder: '🔍  Bu kategoride ara...',
                    onChange: function () { applyFilter(); },
                    onSubmit: function () {
                        applyFilter();
                        App.Nav.focus(chHost);
                    }
                });
                filterWrap.appendChild(filterField.root);
                chHead.appendChild(filterWrap);
                colCh.appendChild(chHead);

                chHost = U.el('div', 'col__body');
                colCh.appendChild(chHost);
                cols.appendChild(colCh);

                /* EPG paneli */
                var colSide = U.el('div', 'col col--side');
                colSide.appendChild(U.el('div', 'col__head', 'KANAL BILGISI'));
                var sideBody = U.el('div', 'col__body');
                sideEl = U.el('div', 'side');
                sideBody.appendChild(sideEl);
                colSide.appendChild(sideBody);
                cols.appendChild(colSide);

                body.appendChild(cols);
                root.appendChild(body);

                /* --- Ipuclari --- */
                var hints = U.el('div', 'hintbar');
                hints.innerHTML =
                    '<span class="hint"><span class="hint__key">OK</span> Izle</span>' +
                    '<span class="hint"><span class="hint__key">SARI</span> Favori</span>' +
                    '<span class="hint"><span class="hint__key">0-9</span> Kanal no</span>' +
                    '<span class="hint"><span class="hint__key">▲</span> Kategoride ara</span>' +
                    '<span class="hint"><span class="hint__key">CH+/-</span> Sayfa</span>' +
                    '<span class="hint"><span class="hint__key">RETURN</span> Geri</span>';
                root.appendChild(hints);

                /* --- Sanal listeler --- */
                catList = App.UI.VirtualList.create({
                    container: catHost,
                    itemHeight: U.rem(4.5),
                    create: createCategory,
                    update: updateCategory,
                    onFocusChange: onCategoryFocus,
                    onSelect: selectCategory,
                    onEdge: function (dir) {
                        if (dir === 'right') { selectCategory(catList.getItem()); return true; }
                        return false;
                    },
                    emptyText: 'Kategori bulunamadi'
                });

                chList = App.UI.VirtualList.create({
                    container: chHost,
                    itemHeight: U.rem(5.5),
                    create: createChannel,
                    update: updateChannel,
                    onFocusChange: function (item) {
                        renderSide(item);
                        loadEpgFor(item);
                    },
                    onSelect: openChannel,
                    onEdge: function (dir) {
                        if (dir === 'left') { App.Nav.focus(catHost); return true; }
                        if (dir === 'up') { filterField.focusBox(); return true; }
                        return true;   /* saga cikis yok - odak kaymasin */
                    },
                    emptyText: 'Kanal bulunamadi'
                });

                App.Nav.bind(catHost, function () { catList.select(); }, {
                    onFocus: function () { catList.setActive(true); },
                    onBlur: function () { catList.setActive(false); }
                });
                App.Nav.bind(chHost, function () { chList.select(); }, {
                    onFocus: function () { chList.setActive(true); },
                    onBlur: function () { chList.setActive(false); },
                    isDefault: true
                });

                App.Bus.on('favorites:change', onFavChange);

                /* Veri yuklemesi router gecisini BLOKLAMAZ: ekran hemen acilir,
                   liste "Yukleniyor..." gosterir. Boylece yavas bir sunucuda
                   kullanici RETURN ile hemen geri donebilir. */
                App.Nav.focus(chHost);
                App.UI.Loading.show('Kategoriler yukleniyor...');
                loadCategories().then(function () {
                    App.UI.Loading.hide();
                    if (destroyed) { return; }
                    App.Nav.focus(chHost);
                    if (chList.count()) { chList.setActive(true); }
                }, function (err) {
                    App.UI.Loading.hide();
                    if (destroyed) { return; }
                    var e = App.AppError.wrap(err);
                    App.UI.Modal.retry('Kanallar yuklenemedi', e.message)
                        .then(function (c) {
                            if (c === 'retry') {
                                App.UI.Loading.show('Yeniden deneniyor...');
                                loadCategories().then(function () { App.UI.Loading.hide(); },
                                                      function () { App.UI.Loading.hide(); App.Router.back(); });
                            } else {
                                App.Router.back();
                            }
                        });
                });
            },

            onResume: function () {
                if (chList) { chList.refresh(); }
                var cur = chList && chList.getItem();
                if (cur) { renderSide(cur); loadEpgFor(cur); }
            },

            onKey: function (code) {
                if (App.Keys.isNumberKey(code)) {
                    pushNumber(App.Keys.numberOf(code));
                    return true;
                }
                if (code === KEY.YELLOW) { toggleFav(); return true; }
                if (code === KEY.BLUE) {
                    /* Favori kategorisine hizli gecis */
                    var favIdx = catList.jumpTo(function (c) {
                        return c.id === App.Content.FAV_ID;
                    });
                    if (favIdx > -1) {
                        App.Nav.focus(catHost);
                        loadChannels(categories[favIdx]);
                    }
                    return true;
                }
                if (code === KEY.RED) {
                    var cat = catList.getItem();
                    if (!cat) { return true; }
                    if (cat.id === App.Content.FAV_ID) { loadChannels(cat); return true; }
                    App.UI.Loading.show('Kanallar yenileniyor...');
                    App.Content.getLiveChannels(cat.id, true).then(function (list) {
                        App.UI.Loading.hide();
                        if (destroyed) { return; }
                        /* Onceden burada tanimsiz afterChannels() cagriliyordu
                           (hata firlatiyordu) ve arama filtresi yok sayiliyordu. */
                        allChannels = list || [];
                        applyFilter();
                        App.UI.Toast.success('Kanal listesi yenilendi');
                    }, function (err) {
                        App.UI.Loading.hide();
                        App.UI.Toast.fromError(err, 'Yenilenemedi:');
                    });
                    return true;
                }
                if (code === KEY.SEARCH) { App.Router.go('search'); return true; }
                return false;
            },

            onBack: function () {
                /* Kanal listesindeysek once kategori kolonuna don */
                if (App.Nav.get() === chHost && catList && catList.count() > 1) {
                    App.Nav.focus(catHost);
                    return true;
                }
                return false;   /* Router bir ust ekrana donsun */
            },

            unmount: function () {
                destroyed = true;
                if (epgTimer) { clearTimeout(epgTimer); }
                if (chanTimer) { clearTimeout(chanTimer); }
                if (numTimer) { clearTimeout(numTimer); }
                App.Bus.off('favorites:change', onFavChange);
                App.UI.ImageLoader.flush();
                if (catList) { catList.destroy(); }
                if (chList) { chList.destroy(); }
                catList = chList = null;
                filterField = null;
            }
        };
    };
})(window.App = window.App || {});
