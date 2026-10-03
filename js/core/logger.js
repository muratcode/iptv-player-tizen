/* ============================================================
   js/core/logger.js
   TV'de console cikisini Tizen Studio "Log" sekmesinden veya
   sdb dlog uzerinden izleyebilirsiniz. Uretimde LEVEL='warn'
   yaparak gereksiz string birlestirme maliyetini sifirlayin.
   ============================================================ */
(function (App) {
    'use strict';

    var LEVELS = { debug: 10, info: 20, warn: 30, error: 40, none: 100 };
    var current = LEVELS.debug;
    var buffer = [];              /* Ayarlar > Tani ekraninda gosterilir */
    var MAX_BUFFER = 200;

    function write(level, tag, args) {
        if (LEVELS[level] < current) { return; }
        var parts = ['[' + tag + ']'];
        for (var i = 0; i < args.length; i++) {
            var a = args[i];
            if (a && typeof a === 'object') {
                try { parts.push(JSON.stringify(a)); } catch (e) { parts.push(String(a)); }
            } else {
                parts.push(String(a));
            }
        }
        var line = parts.join(' ');

        buffer.push({ t: Date.now(), level: level, line: line });
        if (buffer.length > MAX_BUFFER) { buffer.shift(); }

        try {
            if (level === 'error' && console.error) { console.error(line); }
            else if (level === 'warn' && console.warn) { console.warn(line); }
            else if (console.log) { console.log(line); }
        } catch (e) { /* TV'de console bazen yok */ }
    }

    function make(tag) {
        return {
            debug: function () { write('debug', tag, arguments); },
            info:  function () { write('info',  tag, arguments); },
            warn:  function () { write('warn',  tag, arguments); },
            error: function () { write('error', tag, arguments); }
        };
    }

    App.Logger = {
        get: make,
        setLevel: function (name) { if (LEVELS[name] !== undefined) { current = LEVELS[name]; } },
        getLevel: function () {
            for (var k in LEVELS) {
                if (LEVELS[k] === current) { return k; }
            }
            return 'debug';
        },
        dump: function () { return buffer.slice(); },
        clear: function () { buffer.length = 0; }
    };
})(window.App = window.App || {});
