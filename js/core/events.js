/* ============================================================
   js/core/events.js - Cok kucuk global olay veriyolu (event bus)
   Moduller arasi gevsek bagli iletisim icin. Ornegin oynatici
   'player:state' yayinlar, view dinler.
   ============================================================ */
(function (App) {
    'use strict';

    function Emitter() { this._map = {}; }

    Emitter.prototype.on = function (name, fn) {
        if (!this._map[name]) { this._map[name] = []; }
        this._map[name].push(fn);
        return fn;
    };

    Emitter.prototype.once = function (name, fn) {
        var self = this;
        var wrapper = function (data) {
            self.off(name, wrapper);
            fn(data);
        };
        return this.on(name, wrapper);
    };

    Emitter.prototype.off = function (name, fn) {
        var list = this._map[name];
        if (!list) { return; }
        if (!fn) { delete this._map[name]; return; }
        var i = list.indexOf(fn);
        if (i !== -1) { list.splice(i, 1); }
    };

    Emitter.prototype.emit = function (name, data) {
        var list = this._map[name];
        if (!list || !list.length) { return; }
        /* Dinleyici listesi calisirken degisebilir -> kopya uzerinde don */
        var copy = list.slice();
        for (var i = 0; i < copy.length; i++) {
            try { copy[i](data, name); }
            catch (e) {
                if (App.Logger) { App.Logger.get('Events').error('listener error', name, e && e.message); }
            }
        }
    };

    Emitter.prototype.clear = function () { this._map = {}; };

    App.Emitter = Emitter;
    App.Bus = new Emitter();
})(window.App = window.App || {});
