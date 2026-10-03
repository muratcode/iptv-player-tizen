/* ============================================================
   js/core/actions.js
   Ekranlar arasi ortak eylemler - "bir icerik secildiginde ne olur"
   mantiginin tek yerde toplanmasi.
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;

    App.Actions = {
        /**
         * Bir icerigi ac. Turune gore oynaticiya veya detay ekranina gider.
         * @param {object} item
         * @param {object} [opts] {items, index, returnTo, askResume}
         */
        open: function (item, opts) {
            opts = opts || {};
            if (!item) { return; }

            if (item.type === 'series') {
                App.Router.go('seriesDetail', { series: item });
                return;
            }

            var ctx = { items: opts.items || [item], index: opts.index !== undefined ? opts.index : 0 };

            /* Film / bolum ise kaldigi yerden devam sor */
            if (item.type !== 'live' && opts.askResume !== false) {
                var sec = App.History.resumeOf(item.key);
                if (sec > 0) {
                    App.UI.Modal.choose(item.name, [
                        { label: 'Kaldigin yerden devam et  (' + U.duration(sec) + ')', value: 'resume', icon: '▶' },
                        { label: 'Bastan oynat', value: 'play', icon: '⏮' }
                    ]).then(function (choice) {
                        if (!choice) { return; }
                        App.Router.go('player', {
                            item: item, context: ctx,
                            startMs: choice === 'play' ? 0 : sec * 1000,
                            returnTo: opts.returnTo
                        });
                    });
                    return;
                }
            }

            App.Router.go('player', {
                item: item, context: ctx, startMs: 0, returnTo: opts.returnTo
            });
        },

        /** Icerik turunun okunabilir adi */
        typeName: function (type) {
            return ({
                live: 'Kanal',
                movie: 'Film',
                series: 'Dizi',
                episode: 'Bolum'
            })[type] || 'Icerik';
        },

        typeGlyph: function (type) {
            return ({
                live: '📡', movie: '🎬', series: '📺', episode: '🎞'
            })[type] || '•';
        }
    };
})(window.App = window.App || {});
