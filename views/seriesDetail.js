/* ============================================================
   views/seriesDetail.js
   DIZI DETAYI - sezon secimi + bolum listesi

   Ust : afis, dizi adi, tur/yil/puan, ozet
   Orta: sezon dugmeleri (yatay)
   Alt : secili sezonun bolum listesi (sanal liste)

   Back davranisi: bolum listesindeysen once sezon satirina,
   oradan bir sonraki Back ile dizi listesine donulur.
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    var KEY = App.Keys.KEY;
    var log = App.Logger.get('SeriesDetail');

    App.Views = App.Views || {};

    App.Views.seriesDetail = function () {
        var root, epHost, seasonsEl, posterEl;
        var epList = null;
        var seriesItem = null, info = null;
        var seasonIndex = 0;
        var seasonChips = [];
        var destroyed = false;

        function renderEpisode(node, item) {
            U.empty(node);
            node.style.height = U.rem(5) + 'px';

            node.appendChild(U.el('span', 'ch__num', item.episodeNum || ''));

            var texts = U.el('div', 'ch__texts');
            texts.appendChild(U.el('div', 'ch__name', item.name));

            var sub = [];
            if (item.durationSecs) { sub.push(U.duration(item.durationSecs)); }
            else if (item.duration) { sub.push(item.duration); }
            var prog = App.History.progressOf(item.key);
            if (prog > 0.02) { sub.push('%' + Math.round(prog * 100) + ' izlendi'); }
            if (item.plot) { sub.push(U.truncate(item.plot, 90)); }
            texts.appendChild(U.el('div', 'ch__epg', sub.join('  •  ')));

            node.appendChild(texts);
            node.appendChild(U.el('span', 'ch__fav', App.Favorites.has(item) ? '★' : ''));
        }

        function buildSeasons() {
            U.empty(seasonsEl);
            seasonChips = [];

            if (!info || !info.seasons.length) { return; }

            for (var i = 0; i < info.seasons.length; i++) {
                (function (s, idx) {
                    var chip = U.el('div', 'season-chip',
                        'Sezon ' + s.number + '  (' + s.episodes.length + ')');
                    App.Nav.bind(chip, function () {
                        selectSeason(idx);
                        App.Nav.focus(epHost);
                    });
                    chip.__navFocus = function () { selectSeason(idx); };
                    seasonsEl.appendChild(chip);
                    seasonChips.push(chip);
                })(info.seasons[i], i);
            }
        }

        function selectSeason(idx) {
            if (!info || idx < 0 || idx >= info.seasons.length) { return; }
            seasonIndex = idx;
            for (var i = 0; i < seasonChips.length; i++) {
                U.toggleClass(seasonChips[i], 'is-selected', i === idx);
            }
            var eps = info.seasons[idx].episodes;
            epList.setItems(eps, { emptyText: 'Bu sezonda bolum bulunamadi', emptyIcon: '📭' });
        }

        function currentEpisodes() {
            if (!info || !info.seasons[seasonIndex]) { return []; }
            return info.seasons[seasonIndex].episodes;
        }

        /**
         * TUM sezonlarin bolumlerini tek diziye serer.
         * Oynatici baglami bu listedir; boylece bir sezon bitince
         * "sonraki bolum" bir sonraki SEZONUN ilk bolumune gecebilir
         * (oynatici sezon degisiminde kullaniciya sorar).
         * Ayrica her bolume dizi adi eklenir - oynaticida baslikta gorunur.
         */
        function allEpisodes() {
            var out = [];
            if (!info) { return out; }
            for (var s = 0; s < info.seasons.length; s++) {
                var eps = info.seasons[s].episodes;
                for (var e = 0; e < eps.length; e++) {
                    if (!eps[e].seriesName) {
                        eps[e].seriesName = info.name || seriesItem.name;
                    }
                    out.push(eps[e]);
                }
            }
            return out;
        }

        function indexInAll(all, item) {
            for (var i = 0; i < all.length; i++) {
                if (all[i].key === item.key) { return i; }
            }
            return 0;
        }

        function playEpisode(item) {
            var all = allEpisodes();
            var idx = indexInAll(all, item);
            var resumeSec = App.History.resumeOf(item.key);

            if (resumeSec > 0) {
                App.UI.Modal.choose(item.name, [
                    { label: 'Kaldigin yerden devam et  (' + U.duration(resumeSec) + ')', value: 'resume', icon: '▶' },
                    { label: 'Bastan oynat', value: 'play', icon: '⏮' }
                ]).then(function (choice) {
                    if (!choice) { return; }
                    start(item, all, idx, choice === 'play' ? 0 : resumeSec * 1000);
                });
            } else {
                start(item, all, idx, 0);
            }
        }

        function start(item, eps, index, startMs) {
            App.Router.go('player', {
                item: item,
                context: { items: eps, index: index },
                startMs: startMs,
                returnTo: 'seriesDetail'
            });
        }

        function toggleFav() {
            var item = epList && epList.getItem();
            if (!item) { return; }
            var on = App.Favorites.toggle(item);
            App.UI.Toast.info(on ? '★ Favorilere eklendi' : 'Favorilerden cikarildi');
            epList.refreshIndex(epList.getIndex());
        }

        function fillHeader() {
            var meta = [];
            if (info.releaseDate) { meta.push(String(info.releaseDate).substr(0, 4)); }
            if (info.genre) { meta.push(info.genre); }
            if (info.rating) { meta.push('★ ' + info.rating); }
            meta.push(info.seasons.length + ' sezon');
            meta.push(info.episodeCount + ' bolum');
            return meta.join('  •  ');
        }

        return {
            id: 'seriesDetail',
            title: 'Dizi Detayi',

            mount: function (container, params) {
                root = container;
                destroyed = false;
                seriesItem = params && params.series;

                if (!seriesItem) {
                    return Promise.reject(new App.AppError(App.ERR.NOT_FOUND, 'dizi belirtilmedi'));
                }

                var bar = U.el('div', 'topbar');
                bar.appendChild(U.el('div', 'topbar__title', '📺 ' + U.truncate(seriesItem.name, 48)));
                bar.appendChild(U.el('div', 'topbar__spacer'));
                root.appendChild(bar);

                var body = U.el('div', 'body');
                var wrap = U.el('div', 'sdet');

                posterEl = U.el('div', 'sdet__poster');
                wrap.appendChild(posterEl);

                var infoCol = U.el('div', 'sdet__info');
                infoCol.appendChild(U.el('div', 'sdet__title', seriesItem.name));
                var metaEl = U.el('div', 'sdet__meta', 'Yukleniyor...');
                infoCol.appendChild(metaEl);
                var plotEl = U.el('div', 'sdet__plot clamp-4', seriesItem.plot || '');
                infoCol.appendChild(plotEl);

                seasonsEl = U.el('div', 'sdet__seasons');
                infoCol.appendChild(seasonsEl);

                var epsWrap = U.el('div', 'sdet__eps');
                epHost = U.el('div', 'col__body');
                epHost.style.top = '0';
                epsWrap.appendChild(epHost);
                infoCol.appendChild(epsWrap);

                wrap.appendChild(infoCol);
                body.appendChild(wrap);
                root.appendChild(body);

                var hints = U.el('div', 'hintbar');
                hints.innerHTML =
                    '<span class="hint"><span class="hint__key">OK</span> Bolumu oynat</span>' +
                    '<span class="hint"><span class="hint__key">SARI</span> Favori</span>' +
                    '<span class="hint"><span class="hint__key">RETURN</span> Geri</span>';
                root.appendChild(hints);

                App.UI.ImageLoader.into(posterEl, seriesItem.logo, U.initials(seriesItem.name));

                epList = App.UI.VirtualList.create({
                    container: epHost,
                    itemHeight: U.rem(5),
                    render: renderEpisode,
                    onSelect: playEpisode,
                    onEdge: function (dir) {
                        if (dir === 'up' && seasonChips.length) {
                            App.Nav.focus(seasonChips[seasonIndex]);
                            return true;
                        }
                        return true;
                    }
                });

                App.Nav.bind(epHost, function () { epList.select(); }, {
                    onFocus: function () { epList.setActive(true); },
                    onBlur: function () { epList.setActive(false); },
                    isDefault: true
                });

                /* Veri yuklemesi router gecisini BLOKLAMAZ: ekran hemen acilir,
                   liste "Yukleniyor..." gosterir. Boylece yavas bir sunucuda
                   kullanici RETURN ile hemen geri donebilir. */
                App.Nav.focus(epHost);
                App.UI.Loading.show('Sezon ve bolumler yukleniyor...');

                App.Content.getSeriesInfo(seriesItem.id).then(function (data) {
                    App.UI.Loading.hide();
                    if (destroyed) { return; }
                    info = data;

                    if (info.plot) { plotEl.textContent = info.plot; }
                    metaEl.textContent = fillHeader();
                    if (info.cover) {
                        App.UI.ImageLoader.into(posterEl, info.cover, U.initials(seriesItem.name));
                    }

                    if (!info.seasons.length) {
                        epList.setItems([], {
                            emptyText: 'Bu dizi icin bolum bilgisi bulunamadi',
                            emptyIcon: '📭'
                        });
                        return;
                    }

                    buildSeasons();
                    selectSeason(0);
                    App.Nav.focus(epHost);
                    epList.setActive(true);
                }, function (err) {
                    App.UI.Loading.hide();
                    var e = App.AppError.wrap(err);
                    log.error('dizi detayi', e.code, e.detail);
                    App.UI.Modal.retry('Bolumler yuklenemedi', e.message).then(function (c) {
                        if (c === 'retry') { App.Router.replace('seriesDetail', { series: seriesItem }); }
                        else { App.Router.back(); }
                    });
                });
            },

            onResume: function () { if (epList) { epList.refresh(); } },

            onKey: function (code) {
                if (code === KEY.YELLOW) { toggleFav(); return true; }
                /* Renkli tuslarla hizli sezon degistirme */
                if (code === KEY.CH_UP && info) {
                    selectSeason(Math.max(0, seasonIndex - 1));
                    return true;
                }
                if (code === KEY.CH_DOWN && info) {
                    selectSeason(Math.min(info.seasons.length - 1, seasonIndex + 1));
                    return true;
                }
                return false;
            },

            onBack: function () {
                /* Bolum listesindeysek once sezon satirina don */
                if (App.Nav.get() === epHost && seasonChips.length) {
                    App.Nav.focus(seasonChips[seasonIndex]);
                    return true;
                }
                return false;
            },

            unmount: function () {
                destroyed = true;
                App.UI.ImageLoader.flush();
                if (epList) { epList.destroy(); }
                epList = null;
                seasonChips = [];
            }
        };
    };
})(window.App = window.App || {});
