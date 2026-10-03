/* ============================================================
   js/ui/qrcode.js
   Saf ES5 QR Code (Model 2) kodlayici + <canvas> cizici.

   NEDEN KENDI KODLAYICIMIZ?
   Tizen .wgt paketi CEVRIMDISI calisir; CDN'den kutuphane
   cekilemez (config.xml disa erisimi yalnizca kullanicinin IPTV
   sunucusu icin acar). Bu yuzden kodlayici uygulamanin icinde
   yer alir. Harici bagimlilik, reklam veya takip YOKTUR.

   KAPSAM
     - Mod       : 8-bit byte (UTF-8)  -> her turlu URL/metin
     - ECC       : L (%7) ve M (%15)
     - Surumler  : 1 - 15  (v15-L'de 523 bayta kadar)
     - Maskeleme : 8 maskenin tamami denenir, ceza puani en dusuk
                   olan secilir (standardin gerektirdigi davranis)

   KULLANIM
     App.UI.QRCode.render(hostEl, 'http://...', { size: 420 });
     var m = App.UI.QRCode.make('metin', 'M');   // {size, modules}
   ============================================================ */
(function (App) {
    'use strict';

    App.UI = App.UI || {};

    /* ---------------- Galois alani GF(256), uretici 0x11D ---------------- */
    var EXP = new Array(256);
    var LOG = new Array(256);
    (function initGF() {
        var x = 1;
        for (var i = 0; i < 255; i++) {
            EXP[i] = x;
            LOG[x] = i;
            x <<= 1;
            if (x & 0x100) { x ^= 0x11D; }
        }
        for (var j = 255; j < 256; j++) { EXP[j] = EXP[j - 255]; }
    })();

    function gfMul(a, b) {
        if (a === 0 || b === 0) { return 0; }
        return EXP[(LOG[a] + LOG[b]) % 255];
    }

    /** Reed-Solomon uretici polinomu (derece n) */
    function rsGenerator(n) {
        var poly = [1];
        for (var i = 0; i < n; i++) {
            var next = new Array(poly.length + 1);
            for (var k = 0; k < next.length; k++) { next[k] = 0; }
            for (var j = 0; j < poly.length; j++) {
                next[j] ^= gfMul(poly[j], 1);
                next[j + 1] ^= gfMul(poly[j], EXP[i]);
            }
            poly = next;
        }
        return poly;
    }

    /** Veri blogu icin ECC baytlarini uretir */
    function rsEncode(data, ecCount) {
        var gen = rsGenerator(ecCount);
        var res = new Array(data.length + ecCount);
        var i;
        for (i = 0; i < data.length; i++) { res[i] = data[i]; }
        for (i = data.length; i < res.length; i++) { res[i] = 0; }

        for (i = 0; i < data.length; i++) {
            var factor = res[i];
            if (factor === 0) { continue; }
            for (var j = 0; j < gen.length; j++) {
                res[i + j] ^= gfMul(gen[j], factor);
            }
        }
        return res.slice(data.length);
    }

    /* ---------------- Standart tablolar ----------------
       RS_BLOCKS[version][level] = [blokSayisi, toplamKod, veriKod, (2. grup...)]
       level sirasi: L, M, Q, H  (biz L ve M kullaniyoruz) */
    var RS_BLOCKS = [
        null,
        [[1, 26, 19], [1, 26, 16], [1, 26, 13], [1, 26, 9]],
        [[1, 44, 34], [1, 44, 28], [1, 44, 22], [1, 44, 16]],
        [[1, 70, 55], [1, 70, 44], [2, 35, 17], [2, 35, 13]],
        [[1, 100, 80], [2, 50, 32], [2, 50, 24], [4, 25, 9]],
        [[1, 134, 108], [2, 67, 43], [2, 33, 15, 2, 34, 16], [2, 33, 11, 2, 34, 12]],
        [[2, 86, 68], [4, 43, 27], [4, 43, 19], [4, 43, 15]],
        [[2, 98, 78], [4, 49, 31], [2, 32, 14, 4, 33, 15], [4, 39, 13, 1, 40, 14]],
        [[2, 121, 97], [2, 60, 38, 2, 61, 39], [4, 40, 18, 2, 41, 19], [4, 40, 14, 2, 41, 15]],
        [[2, 146, 116], [3, 58, 36, 2, 59, 37], [4, 36, 16, 4, 37, 17], [4, 36, 12, 4, 37, 13]],
        [[2, 86, 68, 2, 87, 69], [4, 69, 43, 1, 70, 44], [6, 43, 19, 2, 44, 20], [6, 43, 15, 2, 44, 16]],
        [[4, 101, 81], [1, 80, 50, 4, 81, 51], [4, 50, 22, 4, 51, 23], [3, 36, 12, 8, 37, 13]],
        [[2, 116, 92, 2, 117, 93], [6, 58, 36, 2, 59, 37], [4, 46, 20, 6, 47, 21], [7, 42, 14, 4, 43, 15]],
        [[4, 133, 107], [8, 59, 37, 1, 60, 38], [8, 44, 20, 4, 45, 21], [12, 33, 11, 4, 34, 12]],
        [[3, 145, 115, 1, 146, 116], [4, 64, 40, 5, 65, 41], [11, 36, 16, 5, 37, 17], [11, 36, 12, 5, 37, 13]],
        [[5, 109, 87, 1, 110, 88], [5, 65, 41, 5, 66, 42], [5, 54, 24, 7, 55, 25], [11, 36, 12, 7, 37, 13]]
    ];

    var ALIGN_POS = [
        [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
        [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
        [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70]
    ];

    var LEVEL_INDEX = { L: 0, M: 1, Q: 2, H: 3 };
    /* Format bilgisindeki EC gostergesi (L=01, M=00, Q=11, H=10) */
    var LEVEL_BITS = { L: 1, M: 0, Q: 3, H: 2 };

    var MAX_VERSION = 15;

    /* ---------------- Bit tamponu ---------------- */
    function BitBuffer() { this.buf = []; this.len = 0; }
    BitBuffer.prototype.put = function (num, length) {
        for (var i = 0; i < length; i++) {
            this.putBit(((num >>> (length - i - 1)) & 1) === 1);
        }
    };
    BitBuffer.prototype.putBit = function (bit) {
        var idx = Math.floor(this.len / 8);
        if (this.buf.length <= idx) { this.buf.push(0); }
        if (bit) { this.buf[idx] |= (0x80 >>> (this.len % 8)); }
        this.len++;
    };

    /* ---------------- UTF-8 ---------------- */
    function toUtf8Bytes(str) {
        var out = [];
        for (var i = 0; i < str.length; i++) {
            var c = str.charCodeAt(i);
            if (c < 0x80) {
                out.push(c);
            } else if (c < 0x800) {
                out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
            } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
                /* surrogate cifti */
                var c2 = str.charCodeAt(++i);
                var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
                out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F),
                         0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
            } else {
                out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
            }
        }
        return out;
    }

    /* ---------------- Blok bilgisi ---------------- */
    function blocksOf(version, level) {
        var spec = RS_BLOCKS[version][LEVEL_INDEX[level]];
        var list = [];
        for (var i = 0; i < spec.length; i += 3) {
            for (var n = 0; n < spec[i]; n++) {
                list.push({ total: spec[i + 1], data: spec[i + 2] });
            }
        }
        return list;
    }

    function dataCapacityBytes(version, level) {
        var blocks = blocksOf(version, level), total = 0;
        for (var i = 0; i < blocks.length; i++) { total += blocks[i].data; }
        return total;
    }

    /* ---------------- Format / surum bilgisi ---------------- */
    var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | 1;
    var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | 1;
    var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

    function bitLength(n) {
        var c = 0;
        while (n !== 0) { c++; n >>>= 1; }
        return c;
    }

    function formatInfo(level, mask) {
        var data = (LEVEL_BITS[level] << 3) | mask;
        var d = data << 10;
        while (bitLength(d) - bitLength(G15) >= 0) {
            d ^= (G15 << (bitLength(d) - bitLength(G15)));
        }
        return ((data << 10) | d) ^ G15_MASK;
    }

    function versionInfo(version) {
        var d = version << 12;
        while (bitLength(d) - bitLength(G18) >= 0) {
            d ^= (G18 << (bitLength(d) - bitLength(G18)));
        }
        return (version << 12) | d;
    }

    /* ---------------- Maskeleme ---------------- */
    function maskFn(mask, i, j) {
        switch (mask) {
            case 0: return (i + j) % 2 === 0;
            case 1: return i % 2 === 0;
            case 2: return j % 3 === 0;
            case 3: return (i + j) % 3 === 0;
            case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
            case 5: return ((i * j) % 2) + ((i * j) % 3) === 0;
            case 6: return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
            case 7: return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0;
        }
        return false;
    }

    /* ---------------- Matris kurulumu ---------------- */
    function makeMatrix(version, level, dataBytes, mask, test) {
        var size = version * 4 + 17;
        var m = new Array(size);
        var i, j;
        for (i = 0; i < size; i++) {
            m[i] = new Array(size);
            for (j = 0; j < size; j++) { m[i][j] = null; }
        }

        /* Konum belirleme (finder) desenleri + ayiricilar */
        function finder(row, col) {
            for (var r = -1; r <= 7; r++) {
                for (var c = -1; c <= 7; c++) {
                    if (row + r < 0 || row + r >= size || col + c < 0 || col + c >= size) { continue; }
                    var on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                             (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                             (r >= 2 && r <= 4 && c >= 2 && c <= 4);
                    m[row + r][col + c] = on;
                }
            }
        }
        finder(0, 0);
        finder(size - 7, 0);
        finder(0, size - 7);

        /* Hizalama (alignment) desenleri */
        var pos = ALIGN_POS[version];
        for (i = 0; i < pos.length; i++) {
            for (j = 0; j < pos.length; j++) {
                var row = pos[i], col = pos[j];
                if (m[row][col] !== null) { continue; }
                for (var r2 = -2; r2 <= 2; r2++) {
                    for (var c2 = -2; c2 <= 2; c2++) {
                        m[row + r2][col + c2] =
                            (r2 === -2 || r2 === 2 || c2 === -2 || c2 === 2 ||
                             (r2 === 0 && c2 === 0));
                    }
                }
            }
        }

        /* Zamanlama (timing) desenleri */
        for (i = 8; i < size - 8; i++) {
            if (m[i][6] === null) { m[i][6] = (i % 2 === 0); }
            if (m[6][i] === null) { m[6][i] = (i % 2 === 0); }
        }

        /* Karanlik modul */
        m[size - 8][8] = !test;

        /* Surum bilgisi (v7+) */
        if (version >= 7) {
            var vi = versionInfo(version);
            for (i = 0; i < 18; i++) {
                var bit = !test && ((vi >> i) & 1) === 1;
                m[Math.floor(i / 3)][i % 3 + size - 8 - 3] = bit;
                m[i % 3 + size - 8 - 3][Math.floor(i / 3)] = bit;
            }
        }

        /* Format bilgisi */
        var fi = formatInfo(level, mask);
        for (i = 0; i < 15; i++) {
            var b = !test && ((fi >> i) & 1) === 1;
            if (i < 6) { m[i][8] = b; }
            else if (i < 8) { m[i + 1][8] = b; }
            else { m[size - 15 + i][8] = b; }

            if (i < 8) { m[8][size - i - 1] = b; }
            else if (i < 9) { m[8][15 - i - 1 + 1] = b; }
            else { m[8][15 - i - 1] = b; }
        }

        /* Veri yerlesimi: sagdan sola, ikili sutunlar, zikzak */
        var inc = -1;
        var row2 = size - 1;
        var bitIndex = 7;
        var byteIndex = 0;

        for (var col2 = size - 1; col2 > 0; col2 -= 2) {
            if (col2 === 6) { col2--; }   /* dikey zamanlama sutunu atlanir */
            for (;;) {
                for (var c3 = 0; c3 < 2; c3++) {
                    if (m[row2][col2 - c3] === null) {
                        var dark = false;
                        if (byteIndex < dataBytes.length) {
                            dark = ((dataBytes[byteIndex] >>> bitIndex) & 1) === 1;
                        }
                        if (maskFn(mask, row2, col2 - c3)) { dark = !dark; }
                        m[row2][col2 - c3] = dark;
                        bitIndex--;
                        if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
                    }
                }
                row2 += inc;
                if (row2 < 0 || size <= row2) { row2 -= inc; inc = -inc; break; }
            }
        }
        return m;
    }

    /* ---------------- Maske ceza puani (ISO 18004, 8.8.2) ---------------- */
    function penalty(m) {
        var size = m.length, score = 0, i, j;

        /* Kural 1: ayni renkte 5+ ardisik modul */
        for (i = 0; i < size; i++) {
            for (var dir = 0; dir < 2; dir++) {
                var run = 1;
                for (j = 1; j < size; j++) {
                    var a = dir === 0 ? m[i][j - 1] : m[j - 1][i];
                    var b = dir === 0 ? m[i][j] : m[j][i];
                    if (a === b) {
                        run++;
                        if (j === size - 1 && run >= 5) { score += 3 + (run - 5); }
                    } else {
                        if (run >= 5) { score += 3 + (run - 5); }
                        run = 1;
                    }
                }
            }
        }

        /* Kural 2: 2x2 ayni renk bloklari */
        for (i = 0; i < size - 1; i++) {
            for (j = 0; j < size - 1; j++) {
                var v = m[i][j];
                if (v === m[i][j + 1] && v === m[i + 1][j] && v === m[i + 1][j + 1]) { score += 3; }
            }
        }

        /* Kural 3: 1:1:3:1:1 deseni (finder benzeri) */
        var P1 = [true, false, true, true, true, false, true, false, false, false, false];
        var P2 = [false, false, false, false, true, false, true, true, true, false, true];
        function matchAt(get, start) {
            var ok1 = true, ok2 = true;
            for (var k = 0; k < 11; k++) {
                var val = get(start + k);
                if (val !== P1[k]) { ok1 = false; }
                if (val !== P2[k]) { ok2 = false; }
                if (!ok1 && !ok2) { return false; }
            }
            return true;
        }
        for (i = 0; i < size; i++) {
            for (j = 0; j + 11 <= size; j++) {
                (function (ii, jj) {
                    if (matchAt(function (k) { return m[ii][k]; }, jj)) { score += 40; }
                    if (matchAt(function (k) { return m[k][ii]; }, jj)) { score += 40; }
                })(i, j);
            }
        }

        /* Kural 4: koyu modul oraninin %50'den sapmasi */
        var dark = 0;
        for (i = 0; i < size; i++) {
            for (j = 0; j < size; j++) { if (m[i][j]) { dark++; } }
        }
        var ratio = Math.abs(dark * 100 / (size * size) - 50);
        score += Math.floor(ratio / 5) * 10;

        return score;
    }

    /* ---------------- Ana kodlayici ---------------- */

    /**
     * @param {string} text
     * @param {string} [level] 'L' | 'M'  (varsayilan 'M')
     * @returns {{size:number, modules:Array<Array<boolean>>, version:number, level:string}}
     */
    function make(text, level) {
        level = (level === 'L' || level === 'M' || level === 'Q' || level === 'H') ? level : 'M';
        var bytes = toUtf8Bytes(String(text));

        /* En kucuk uygun surumu bul */
        var version = 0;
        for (var v = 1; v <= MAX_VERSION; v++) {
            var lenBits = (v < 10) ? 8 : 16;
            var needBits = 4 + lenBits + bytes.length * 8;
            if (dataCapacityBytes(v, level) * 8 >= needBits) { version = v; break; }
        }
        if (!version) {
            throw new Error('QR: metin cok uzun (' + bytes.length + ' bayt, en fazla ' +
                            dataCapacityBytes(MAX_VERSION, level) + ')');
        }

        /* Bit akisini kur */
        var buf = new BitBuffer();
        buf.put(4, 4);                                   /* 8-bit byte modu */
        buf.put(bytes.length, version < 10 ? 8 : 16);
        for (var i = 0; i < bytes.length; i++) { buf.put(bytes[i], 8); }

        var capacity = dataCapacityBytes(version, level) * 8;
        /* Sonlandirici (en fazla 4 sifir) */
        for (var t = 0; t < 4 && buf.len < capacity; t++) { buf.putBit(false); }
        /* Bayt sinirina hizala */
        while (buf.len % 8 !== 0) { buf.putBit(false); }
        /* Dolgu baytlari */
        var pad = [0xEC, 0x11], p = 0;
        while (buf.buf.length * 8 < capacity) { buf.buf.push(pad[p++ % 2]); }

        /* Bloklara bol, ECC uret, serpistir (interleave) */
        var blocks = blocksOf(version, level);
        var dataBlocks = [], ecBlocks = [];
        var offset = 0, maxData = 0, maxEc = 0;

        for (var b = 0; b < blocks.length; b++) {
            var dCount = blocks[b].data;
            var eCount = blocks[b].total - dCount;
            var d = buf.buf.slice(offset, offset + dCount);
            offset += dCount;
            dataBlocks.push(d);
            ecBlocks.push(rsEncode(d, eCount));
            if (dCount > maxData) { maxData = dCount; }
            if (eCount > maxEc) { maxEc = eCount; }
        }

        var out = [];
        var k;
        for (k = 0; k < maxData; k++) {
            for (b = 0; b < dataBlocks.length; b++) {
                if (k < dataBlocks[b].length) { out.push(dataBlocks[b][k]); }
            }
        }
        for (k = 0; k < maxEc; k++) {
            for (b = 0; b < ecBlocks.length; b++) {
                if (k < ecBlocks[b].length) { out.push(ecBlocks[b][k]); }
            }
        }

        /* 8 maskeyi dene, en dusuk cezaliyi sec */
        var best = null, bestScore = Infinity;
        for (var mask = 0; mask < 8; mask++) {
            var m = makeMatrix(version, level, out, mask, false);
            var sc = penalty(m);
            if (sc < bestScore) { bestScore = sc; best = m; }
        }

        return { size: best.length, modules: best, version: version, level: level };
    }

    /**
     * QR kodunu bir kapsayiciya <canvas> olarak cizer.
     * @param {HTMLElement} host
     * @param {string} text
     * @param {object} [opts] {size:px, level:'L'|'M', margin:modul, dark, light}
     */
    function render(host, text, opts) {
        opts = opts || {};
        var px = opts.size || 360;
        var margin = (opts.margin === undefined) ? 4 : opts.margin;
        var dark = opts.dark || '#000000';
        var light = opts.light || '#ffffff';

        var qr = make(text, opts.level || 'M');
        var total = qr.size + margin * 2;
        var scale = Math.max(1, Math.floor(px / total));
        var canvasSize = scale * total;

        var canvas = document.createElement('canvas');
        canvas.width = canvasSize;
        canvas.height = canvasSize;
        canvas.style.width = canvasSize + 'px';
        canvas.style.height = canvasSize + 'px';
        /* TV'de yumusatma QR'i okunmaz yapar */
        canvas.style.imageRendering = 'pixelated';

        var ctx = null;
        try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
        if (!ctx) {
            /* Canvas kullanilamiyorsa cagiran taraf anlamli bir mesaj gosterebilsin */
            throw new Error('QR: canvas 2d baglami kullanilamiyor');
        }

        ctx.fillStyle = light;
        ctx.fillRect(0, 0, canvasSize, canvasSize);
        ctx.fillStyle = dark;
        for (var r = 0; r < qr.size; r++) {
            for (var c = 0; c < qr.size; c++) {
                if (qr.modules[r][c]) {
                    ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
                }
            }
        }

        while (host.firstChild) { host.removeChild(host.firstChild); }
        host.appendChild(canvas);
        return qr;
    }

    App.UI.QRCode = {
        make: make,
        render: render,
        maxBytes: function (level) { return dataCapacityBytes(MAX_VERSION, level || 'M'); }
    };
})(window.App = window.App || {});
