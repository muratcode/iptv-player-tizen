/* ============================================================
   js/core/polyfill.js
   Eski Samsung TV tarayicilari (Tizen 2.3 = Chromium 34,
   Tizen 2.4 = Chromium 47) icin eksik ES5/ES6 metotlari.
   Bu dosya BASKA HICBIR dosyadan once yuklenmelidir.
   Tum kod tabani bilerek ES5 sozdizimindedir (var / function),
   cunku 2015-2018 model TV'lerde arrow function, class,
   template literal ve async/await desteklenmez veya eksiktir.
   ============================================================ */
(function () {
    'use strict';

    /* ---- Object.assign (Chromium 45+) ---- */
    if (typeof Object.assign !== 'function') {
        Object.defineProperty(Object, 'assign', {
            writable: true, configurable: true,
            value: function (target) {
                if (target === null || target === undefined) {
                    throw new TypeError('Cannot convert undefined or null to object');
                }
                var to = Object(target);
                for (var i = 1; i < arguments.length; i++) {
                    var src = arguments[i];
                    if (src === null || src === undefined) { continue; }
                    for (var k in src) {
                        if (Object.prototype.hasOwnProperty.call(src, k)) { to[k] = src[k]; }
                    }
                }
                return to;
            }
        });
    }

    /* ---- Array.prototype.find / findIndex (Chromium 45+) ---- */
    if (!Array.prototype.find) {
        Array.prototype.find = function (fn, thisArg) {
            for (var i = 0; i < this.length; i++) {
                if (fn.call(thisArg, this[i], i, this)) { return this[i]; }
            }
            return undefined;
        };
    }
    if (!Array.prototype.findIndex) {
        Array.prototype.findIndex = function (fn, thisArg) {
            for (var i = 0; i < this.length; i++) {
                if (fn.call(thisArg, this[i], i, this)) { return i; }
            }
            return -1;
        };
    }
    if (!Array.prototype.includes) {
        Array.prototype.includes = function (v) { return this.indexOf(v) !== -1; };
    }
    if (!Array.from) {
        Array.from = function (arrLike, mapFn) {
            var out = [];
            for (var i = 0; i < arrLike.length; i++) {
                out.push(mapFn ? mapFn(arrLike[i], i) : arrLike[i]);
            }
            return out;
        };
    }

    /* ---- String metotlari ---- */
    if (!String.prototype.startsWith) {
        String.prototype.startsWith = function (s, pos) {
            pos = pos || 0;
            return this.substr(pos, s.length) === s;
        };
    }
    if (!String.prototype.endsWith) {
        String.prototype.endsWith = function (s, len) {
            if (len === undefined || len > this.length) { len = this.length; }
            return this.substring(len - s.length, len) === s;
        };
    }
    if (!String.prototype.includes) {
        String.prototype.includes = function (s, pos) { return this.indexOf(s, pos || 0) !== -1; };
    }
    if (!String.prototype.trim) {
        String.prototype.trim = function () { return this.replace(/^[\s﻿\xA0]+|[\s﻿\xA0]+$/g, ''); };
    }
    if (!String.prototype.repeat) {
        String.prototype.repeat = function (n) {
            var out = '';
            for (var i = 0; i < n; i++) { out += this; }
            return out;
        };
    }

    /* ---- Number ---- */
    if (!Number.isNaN) { Number.isNaN = function (v) { return v !== v; }; }
    if (!Number.isFinite) { Number.isFinite = function (v) { return typeof v === 'number' && isFinite(v); }; }

    /* ---- Element.matches / closest ---- */
    var ep = window.Element && Element.prototype;
    if (ep && !ep.matches) {
        ep.matches = ep.webkitMatchesSelector || ep.msMatchesSelector || ep.mozMatchesSelector;
    }
    if (ep && !ep.closest) {
        ep.closest = function (sel) {
            var node = this;
            while (node && node.nodeType === 1) {
                if (node.matches(sel)) { return node; }
                node = node.parentElement;
            }
            return null;
        };
    }

    /* ---- requestAnimationFrame ---- */
    if (!window.requestAnimationFrame) {
        window.requestAnimationFrame = window.webkitRequestAnimationFrame || function (cb) {
            return window.setTimeout(function () { cb(Date.now()); }, 16);
        };
        window.cancelAnimationFrame = window.webkitCancelAnimationFrame || window.clearTimeout;
    }

    /* ---- performance.now ---- */
    if (!window.performance) { window.performance = {}; }
    if (!window.performance.now) {
        var t0 = Date.now();
        window.performance.now = function () { return Date.now() - t0; };
    }

    /* ---- Date.now ---- */
    if (!Date.now) { Date.now = function () { return new Date().getTime(); }; }

    /* ---- Cok kucuk Promise polyfill'i (Chromium <32 icin guvenlik agi) ----
       Tizen 2.3+ zaten native Promise tasir; bu blok yalnizca ihtiyat amaclidir. */
    if (typeof window.Promise !== 'function') {
        var P = function (executor) {
            var self = this;
            self._s = 0;            /* 0=pending 1=fulfilled 2=rejected */
            self._v = undefined;
            self._cbs = [];
            function settle(state, value) {
                if (self._s !== 0) { return; }
                if (state === 1 && value && typeof value.then === 'function') {
                    value.then(function (v) { settle(1, v); }, function (e) { settle(2, e); });
                    return;
                }
                self._s = state; self._v = value;
                setTimeout(function () {
                    for (var i = 0; i < self._cbs.length; i++) { self._cbs[i](); }
                    self._cbs = [];
                }, 0);
            }
            try {
                executor(function (v) { settle(1, v); }, function (e) { settle(2, e); });
            } catch (e) { settle(2, e); }
        };
        P.prototype.then = function (onOk, onErr) {
            var self = this;
            return new P(function (res, rej) {
                function run() {
                    try {
                        if (self._s === 1) {
                            res(typeof onOk === 'function' ? onOk(self._v) : self._v);
                        } else {
                            if (typeof onErr === 'function') { res(onErr(self._v)); }
                            else { rej(self._v); }
                        }
                    } catch (e) { rej(e); }
                }
                if (self._s === 0) { self._cbs.push(run); } else { setTimeout(run, 0); }
            });
        };
        P.prototype['catch'] = function (fn) { return this.then(null, fn); };
        P.resolve = function (v) { return new P(function (r) { r(v); }); };
        P.reject = function (e) { return new P(function (_, r) { r(e); }); };
        P.all = function (arr) {
            return new P(function (res, rej) {
                var out = [], left = arr.length;
                if (!left) { return res(out); }
                for (var i = 0; i < arr.length; i++) {
                    (function (idx) {
                        P.resolve(arr[idx]).then(function (v) {
                            out[idx] = v;
                            if (--left === 0) { res(out); }
                        }, rej);
                    })(i);
                }
            });
        };
        window.Promise = P;
    }
})();
