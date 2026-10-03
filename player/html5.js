/* ============================================================
   player/html5.js
   HTML5 <video> yedek oynatici.

   NE ZAMAN KULLANILIR?
   Yalnizca webapis.avplay BULUNAMADIGINDA - yani uygulamayi
   Windows'ta Chrome ile acip arayuzu/navigasyonu test ederken.
   Gercek Samsung TV'de DAIMA AVPlay kullanilir.

   Ayni arayuzu (prepare/play/pause/stop/seekTo...) sunar, boylece
   player/controller.js hangi motorun calistigini bilmek zorunda
   kalmaz.

   NOT: Chrome MPEG-TS oynatamaz ve HLS'i yalnizca Safari destekler;
   bu yuzden PC'de gorunt gelmeyebilir. Bu beklenen bir durumdur.
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('Html5');

    function Html5Player() {
        this.name = 'html5';
        this.el = document.getElementById('html5-player');
        this.handlers = {};
        this.isLive = false;
        this.currentUrl = '';
        this._bound = false;
    }

    Html5Player.isAvailable = function () {
        return !!document.getElementById('html5-player');
    };

    Html5Player.prototype.setHandlers = function (h) { this.handlers = h || {}; };

    /* <video> sarma sirasinda baska cagrilari engellemez (AVPlay'in aksine) */
    Html5Player.prototype.isBusy = function () { return false; };

    Html5Player.prototype._fire = function (name) {
        var fn = this.handlers[name];
        if (typeof fn !== 'function') { return; }
        var args = Array.prototype.slice.call(arguments, 1);
        try { fn.apply(null, args); } catch (e) { log.error(name, e && e.message); }
    };

    Html5Player.prototype._bind = function () {
        if (this._bound) { return; }
        this._bound = true;
        var self = this;
        var v = this.el;

        v.addEventListener('waiting', function () { self._fire('onBufferingStart'); });
        v.addEventListener('playing', function () { self._fire('onBufferingComplete'); });
        v.addEventListener('canplay', function () { self._fire('onBufferingComplete'); });
        v.addEventListener('timeupdate', function () {
            self._fire('onTime', Math.floor(v.currentTime * 1000));
        });
        v.addEventListener('ended', function () { self._fire('onComplete'); });
        v.addEventListener('error', function () {
            var code = v.error ? v.error.code : 0;
            var msg = {
                1: 'Yukleme iptal edildi.',
                2: 'Ag hatasi nedeniyle yayin kesildi.',
                3: 'Yayin cozumlenemedi (format desteklenmiyor).',
                4: 'Bu yayin formati tarayici tarafindan desteklenmiyor.'
            }[code] || 'Yayin acilamadi.';
            self._fire('onError', 'HTML5_ERROR_' + code, msg);
        });
    };

    Html5Player.prototype.prepare = function (url, opts) {
        var self = this;
        opts = opts || {};
        this.isLive = !!opts.isLive;
        this.currentUrl = url;
        this._bind();

        return new Promise(function (resolve, reject) {
            var v = self.el;
            var settled = false;

            function ok() {
                if (settled) { return; }
                settled = true;
                cleanup();
                self._fire('onReady');
                resolve();
            }
            function fail() {
                if (settled) { return; }
                settled = true;
                cleanup();
                reject(new App.AppError(App.ERR.PLAYER,
                    'HTML5 <video> bu formati acamadi (PC tarayicisinda HLS/TS beklenen bir kisittir)'));
            }
            function cleanup() {
                v.removeEventListener('loadedmetadata', ok);
                v.removeEventListener('error', fail);
                clearTimeout(guard);
            }

            var guard = setTimeout(fail, 20000);
            v.addEventListener('loadedmetadata', ok);
            v.addEventListener('error', fail);

            try {
                v.src = url;
                v.load();
            } catch (e) {
                cleanup();
                reject(new App.AppError(App.ERR.PLAYER, e && e.message));
            }
        });
    };

    Html5Player.prototype.play = function () {
        document.body.classList.add('player-active');
        this.el.classList.add('is-html5');
        var p = this.el.play();
        if (p && p.catch) { p.catch(function (e) { log.warn('play reddedildi', e && e.message); }); }
        return true;
    };

    Html5Player.prototype.pause = function () { this.el.pause(); return true; };
    Html5Player.prototype.resume = function () { return this.play(); };

    Html5Player.prototype.stop = function () {
        try {
            this.el.pause();
            this.el.removeAttribute('src');
            this.el.load();
        } catch (e) { /* yoksay */ }
        document.body.classList.remove('player-active');
        this.el.classList.remove('is-html5');
    };

    Html5Player.prototype.seekTo = function (ms) {
        try { this.el.currentTime = ms / 1000; return Promise.resolve(true); }
        catch (e) { return Promise.resolve(false); }
    };

    Html5Player.prototype.jump = function (deltaMs) {
        return this.seekTo(this.el.currentTime * 1000 + deltaMs);
    };

    Html5Player.prototype.getState = function () {
        var v = this.el;
        if (!v.src) { return 'NONE'; }
        if (v.ended) { return 'IDLE'; }
        if (v.paused) { return v.readyState >= 2 ? 'PAUSED' : 'IDLE'; }
        return 'PLAYING';
    };

    Html5Player.prototype.getCurrentTime = function () { return Math.floor(this.el.currentTime * 1000); };
    Html5Player.prototype.getDuration = function () {
        var d = this.el.duration;
        return (isFinite(d) ? Math.floor(d * 1000) : 0);
    };

    Html5Player.prototype.setDisplayMethod = function (mode) {
        this.el.style.objectFit = (mode === 'PLAYER_DISPLAY_MODE_FULL_SCREEN') ? 'fill' : 'contain';
    };
    Html5Player.prototype.setDisplayRect = function () { /* CSS ile tam ekran */ };
    Html5Player.prototype.setFullscreen = function () { /* CSS ile tam ekran */ };
    Html5Player.prototype.getTracks = function () { return []; };
    Html5Player.prototype.selectTrack = function () { return false; };
    Html5Player.prototype.setSubtitleHidden = function () { };
    Html5Player.prototype.getBandwidth = function () { return 0; };
    Html5Player.prototype.dispose = function () { this.stop(); };

    App.Html5Player = Html5Player;
})(window.App = window.App || {});
