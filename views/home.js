/* ============================================================
   views/home.js
   Ana ekran - buyuk, sade, kumandayla kolay gezilebilir kartlar.

   Kartlar: Canli TV, Filmler, Diziler, Favoriler, Son Izlenenler,
            Arama, Ayarlar
   Ust barda saat ve hesap bitis tarihi gosterilir.
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    var KEY = App.Keys.KEY;

    App.Views = App.Views || {};

    App.Views.home = function () {
        var root, clockEl, acctEl, cardsEl;
        var clockTimer = null;
        var cards = [];

        var DEFS = [
            { id: 'live', title: 'Canli TV', desc: 'Kanallar ve program rehberi', glyph: '📡', view: 'live' },
            { id: 'movies', title: 'Filmler', desc: 'Film arsivi', glyph: '🎬', view: 'movies' },
            { id: 'series', title: 'Diziler', desc: 'Sezon ve bolumler', glyph: '📺', view: 'series' },
            { id: 'favorites', title: 'Favoriler', desc: 'Kaydettikleriniz', glyph: '⭐', view: 'favorites' },
            { id: 'recent', title: 'Son Izlenenler', desc: 'Kaldiginiz yerden devam', glyph: '🕒', view: 'recent' },
            { id: 'search', title: 'Arama', desc: 'Kanal, film, dizi ara', glyph: '🔍', view: 'search' },
            { id: 'playlists', title: 'Playlistler', desc: 'Kayitli listeler arasi gecis', glyph: '📄', view: 'playlists' },
            { id: 'settings', title: 'Ayarlar', desc: 'Hesap ve oynatici', glyph: '⚙', view: 'settings' }
        ];

        function tickClock() {
            if (!clockEl) { return; }
            var d = new Date();
            clockEl.textContent = U.hhmm(d);
        }

        function accountText() {
            var p = App.Profile.get();
            if (!p) { return ''; }

            if (p.type === 'm3u') {
                var st = App.Content.stats();
                return 'M3U Listesi' + (st ? '  •  ' + st.items + ' oge  •  ' + st.groups + ' grup' : '');
            }

            var ui = App.Profile.getUserInfo();
            if (!ui) { return p.username || 'Xtream'; }

            var parts = [ui.username];
            if (ui.expiresAt) {
                parts.push('Bitis: ' + U.ddmmyyyy(ui.expiresAt));
                if (ui.daysLeft !== null && ui.daysLeft <= 7) {
                    parts.push(ui.daysLeft > 0 ? (ui.daysLeft + ' gun kaldi') : 'SURESI DOLMUS');
                }
            } else {
                parts.push('Sinirsiz');
            }
            if (ui.maxConnections) {
                parts.push('Baglanti: ' + ui.activeConnections + '/' + ui.maxConnections);
            }
            if (ui.isTrial) { parts.push('Deneme hesabi'); }
            return parts.join('  •  ');
        }

        function badgeFor(def) {
            if (def.id === 'favorites') {
                var n = App.Favorites.count();
                return n ? (n + ' oge') : '';
            }
            if (def.id === 'recent') {
                var m = App.History.count();
                return m ? (m + ' kayit') : '';
            }
            if (def.id === 'playlists') {
                var c = App.Profiles.count();
                return c > 1 ? (c + ' liste') : '';
            }
            if (def.id === 'series' && !App.Content.supports('series')) { return 'Bulunamadi'; }
            if (def.id === 'movies' && !App.Content.supports('movies')) { return 'Bulunamadi'; }
            return '';
        }

        function buildCards() {
            cardsEl = U.el('div', 'home__cards');
            cards = [];

            for (var i = 0; i < DEFS.length; i++) {
                (function (def, idx) {
                    var c = U.el('div', 'hcard');
                    c.setAttribute('data-card', def.id);

                    c.appendChild(U.el('div', 'hcard__glyph', def.glyph));

                    var badge = badgeFor(def);
                    if (badge) {
                        var b = U.el('span', 'badge hcard__count', badge);
                        c.appendChild(b);
                    }

                    c.appendChild(U.el('div', 'hcard__title', def.title));
                    c.appendChild(U.el('div', 'hcard__desc', def.desc));

                    App.Nav.bind(c, function () { open(def); }, { isDefault: idx === 0 });
                    cardsEl.appendChild(c);
                    cards.push(c);
                })(DEFS[i], i);
            }
            return cardsEl;
        }

        function open(def) {
            /* M3U kaynaginda dizi/film olmayabilir - kullaniciya net mesaj */
            if (def.id === 'series' && !App.Content.supports('series')) {
                App.UI.Modal.alert('Dizi bulunamadi',
                    'Bu kaynakta dizi icerigi tespit edilemedi.\n\n' +
                    'M3U listelerinde bolumler "Dizi Adi S01 E05" gibi bir kalipla\n' +
                    'adlandirilmissa otomatik olarak dizilere gruplanir.');
                return;
            }
            if (def.id === 'movies' && !App.Content.supports('movies')) {
                App.UI.Modal.alert('Film bulunamadi',
                    'Yuklu playlist icinde film (VOD) icerigi tespit edilemedi.');
                return;
            }
            App.Router.go(def.view);
        }

        function refreshBadges() {
            for (var i = 0; i < cards.length; i++) {
                var id = cards[i].getAttribute('data-card');
                var def = null;
                for (var j = 0; j < DEFS.length; j++) { if (DEFS[j].id === id) { def = DEFS[j]; } }
                if (!def) { continue; }
                var old = cards[i].querySelector('.hcard__count');
                var txt = badgeFor(def);
                if (old) { cards[i].removeChild(old); }
                if (txt) {
                    var b = U.el('span', 'badge hcard__count', txt);
                    cards[i].insertBefore(b, cards[i].firstChild.nextSibling);
                }
            }
        }

        var onFavChange = function () { refreshBadges(); };
        var onHistChange = function () { refreshBadges(); };

        /* Xtream hesap dogrulamasi acilista ARKA PLANDA calisir; sonucu
           geldiginde ust bardaki "Bitis: ..." bilgisini aninda tazele.
           Aksi halde kullanici yalnizca kullanici adini gorur. */
        var onUserInfo = function () {
            if (acctEl) { acctEl.textContent = accountText(); }
        };

        return {
            id: 'home',
            title: 'Ana Ekran',

            mount: function (container) {
                root = container;

                /* --- Ust bar --- */
                var bar = U.el('div', 'topbar');
                bar.appendChild(U.el('div', 'topbar__title', 'IPTV Player'));
                bar.appendChild(U.el('div', 'topbar__spacer'));

                var meta = U.el('div', 'topbar__meta');
                acctEl = U.el('span', '', accountText());
                clockEl = U.el('span', 'topbar__clock', '--:--');
                meta.appendChild(acctEl);
                meta.appendChild(clockEl);
                bar.appendChild(meta);
                root.appendChild(bar);

                /* --- Govde --- */
                var body = U.el('div', 'body');

                var hero = U.el('div', 'home__hero');
                var name = '';
                var p = App.Profile.get();
                if (p && p.type === 'xtream' && p.username) { name = ', ' + p.username; }
                hero.appendChild(U.el('div', 'home__hello', 'Hos geldiniz' + name));
                hero.appendChild(U.el('div', 'home__acct',
                    'Bir bolum secmek icin yon tuslarini, acmak icin OK tusunu kullanin.'));
                body.appendChild(hero);

                body.appendChild(buildCards());
                root.appendChild(body);

                /* --- Alt ipuclari --- */
                var hints = U.el('div', 'hintbar');
                hints.innerHTML =
                    '<span class="hint"><span class="hint__key">OK</span> Ac</span>' +
                    '<span class="hint"><span class="hint__key">RETURN</span> Cikis</span>' +
                    '<span class="hint"><span class="hint__key">KIRMIZI</span> Yenile</span>' +
                    '<span class="hint"><span class="hint__key">SARI</span> Ara</span>';
                root.appendChild(hints);

                tickClock();
                clockTimer = setInterval(tickClock, 20000);

                App.Bus.on('favorites:change', onFavChange);
                App.Bus.on('history:change', onHistChange);
                App.Bus.on('profile:userinfo', onUserInfo);

                App.Nav.focus(cards[0]);
            },

            onResume: function () {
                refreshBadges();
                if (acctEl) { acctEl.textContent = accountText(); }
                tickClock();
            },

            onKey: function (code) {
                if (code === KEY.RED) {
                    App.UI.Loading.show('Liste yenileniyor...', { delay: 0 });
                    App.Content.refresh(function (t) { App.UI.Loading.setProgress(t); })
                        .then(function () {
                            App.UI.Loading.hide(true);
                            App.UI.Toast.success('Icerik yenilendi');
                            refreshBadges();
                        }, function (err) {
                            App.UI.Loading.hide(true);
                            App.UI.Toast.fromError(err, 'Yenilenemedi:');
                        });
                    return true;
                }
                if (code === KEY.YELLOW || code === KEY.SEARCH) {
                    App.Router.go('search');
                    return true;
                }
                return false;
            },

            /* Kok ekran: Back -> Router cikis onayi gosterir */
            onBack: function () { return false; },

            unmount: function () {
                if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
                App.Bus.off('favorites:change', onFavChange);
                App.Bus.off('history:change', onHistChange);
                App.Bus.off('profile:userinfo', onUserInfo);
                cards = [];
            }
        };
    };
})(window.App = window.App || {});
