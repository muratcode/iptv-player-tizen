/* ============================================================
   player/fmp4.js
   Parcali MP4 (fMP4) yazici - player/mse.js icin.

   Tarayicinin Media Source (MSE) oynaticisi MKV kabul etmez; MP4
   parcalari ister. MKV'den cikan kareler burada MP4 kutularina sarilir:
     - baslangic parcasi (ftyp + moov): parca bilgisi, kodek ayarlari
     - medya parcasi (moof + mdat): kareler ve zamanlari

   Desteklenen kodekler: H.264 (avc1), H.265 (hvc1), E-AC-3 (ec-3),
   AC-3 (ac-3), AAC (mp4a). Diger kodekler icin codecFor() null doner
   ve oynatici normal AVPlay yoluna geri doner.
   ============================================================ */
(function (App) {
    'use strict';

    /* ---------------- Kutu yazimi ---------------- */

    function concat(parts) {
        var n = 0;
        var i;
        for (i = 0; i < parts.length; i++) { n += parts[i].length; }
        var out = new Uint8Array(n);
        var p = 0;
        for (i = 0; i < parts.length; i++) { out.set(parts[i], p); p += parts[i].length; }
        return out;
    }

    function u8(v) { return new Uint8Array([v & 0xFF]); }
    function u16(v) { return new Uint8Array([(v >> 8) & 0xFF, v & 0xFF]); }
    function u32(v) {
        return new Uint8Array([(v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF]);
    }
    function u64(v) {
        var hi = Math.floor(v / 4294967296);
        return concat([u32(hi), u32(v - hi * 4294967296)]);
    }
    function i32(v) { return u32(v < 0 ? v + 4294967296 : v); }
    function zeros(n) { return new Uint8Array(n); }
    function ascii(s) {
        var a = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) { a[i] = s.charCodeAt(i); }
        return a;
    }

    function box(type) {
        var parts = Array.prototype.slice.call(arguments, 1);
        var body = concat(parts);
        return concat([u32(body.length + 8), ascii(type), body]);
    }

    function fullBox(type, version, flags) {
        var parts = Array.prototype.slice.call(arguments, 3);
        return box.apply(null, [type, u8(version), u8(flags >> 16), u8(flags >> 8), u8(flags)].concat(parts));
    }

    var MATRIX = concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0),
                         u32(0), u32(0), u32(0x40000000)]);

    /* ---------------- Bit okuyucu ---------------- */

    function Bits(b, p) { this.b = b; this.bit = (p || 0) * 8; }
    Bits.prototype.read = function (n) {
        var v = 0;
        for (var i = 0; i < n; i++) {
            var byte = this.b[this.bit >> 3];
            v = v * 2 + ((byte >> (7 - (this.bit & 7))) & 1);
            this.bit++;
        }
        return v;
    };

    function BitWriter() { this.bytes = []; this.cur = 0; this.n = 0; }
    BitWriter.prototype.put = function (bits, v) {
        for (var i = bits - 1; i >= 0; i--) {
            this.cur = (this.cur << 1) | ((v / Math.pow(2, i)) & 1);
            this.n++;
            if (this.n === 8) { this.bytes.push(this.cur); this.cur = 0; this.n = 0; }
        }
    };
    BitWriter.prototype.done = function () {
        if (this.n) { this.bytes.push(this.cur << (8 - this.n)); this.cur = 0; this.n = 0; }
        return new Uint8Array(this.bytes);
    };

    /* ---------------- Dolby (AC-3 / E-AC-3) ---------------- */

    var ACMOD_CH = [2, 1, 2, 3, 3, 4, 4, 5];
    var AC3_RATES = [48000, 44100, 32000];
    var AC3_BITRATES = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 448, 512, 576, 640];

    /** E-AC-3 cerceve basligi (0x0B77 ile baslar) */
    function eac3Header(b, p) {
        if (b[p] !== 0x0B || b[p + 1] !== 0x77) { return null; }
        var r = new Bits(b, p + 2);
        var h = {};
        h.strmtyp = r.read(2);
        h.substreamid = r.read(3);
        h.size = (r.read(11) + 1) * 2;
        h.fscod = r.read(2);
        if (h.fscod === 3) {
            h.fscod2 = r.read(2);
            h.numblks = 6;
            h.rate = [24000, 22050, 16000][h.fscod2] || 48000;
        } else {
            h.numblks = [1, 2, 3, 6][r.read(2)];
            h.rate = AC3_RATES[h.fscod];
        }
        h.acmod = r.read(3);
        h.lfeon = r.read(1);
        h.bsid = r.read(5);
        h.samples = 256 * h.numblks;
        return h;
    }

    /** AC-3 cerceve basligi */
    function ac3Header(b, p) {
        if (b[p] !== 0x0B || b[p + 1] !== 0x77) { return null; }
        var r = new Bits(b, p + 4);           /* syncword + crc1 */
        var h = {};
        h.fscod = r.read(2);
        h.frmsizecod = r.read(6);
        h.bsid = r.read(5);
        h.bsmod = r.read(3);
        h.acmod = r.read(3);
        if ((h.acmod & 1) && h.acmod !== 1) { r.read(2); }   /* cmixlev */
        if (h.acmod & 4) { r.read(2); }                       /* surmixlev */
        if (h.acmod === 2) { r.read(2); }                     /* dsurmod */
        h.lfeon = r.read(1);
        h.rate = AC3_RATES[h.fscod] || 48000;
        var br = AC3_BITRATES[h.frmsizecod >> 1] || 0;
        var words = h.fscod === 0 ? br * 2 : (h.fscod === 2 ? br * 3 : Math.floor(br * 320 / 147) + (h.frmsizecod & 1));
        h.size = words * 2;
        h.bitrateCode = h.frmsizecod >> 1;
        h.samples = 1536;
        return h;
    }

    function dec3Box(first, depCount, dataRateKbps) {
        var w = new BitWriter();
        w.put(13, Math.min(8191, dataRateKbps));
        w.put(3, 0);                       /* num_ind_sub - 1 */
        w.put(2, first.fscod === 3 ? 3 : first.fscod);
        w.put(5, first.bsid);
        w.put(1, 0);                       /* reserved */
        w.put(1, 0);                       /* asvc */
        w.put(3, 0);                       /* bsmod */
        w.put(3, first.acmod);
        w.put(1, first.lfeon);
        w.put(3, 0);                       /* reserved */
        w.put(4, depCount);
        if (depCount) { w.put(9, 0); } else { w.put(1, 0); }
        return box('dec3', w.done());
    }

    function dac3Box(h) {
        var w = new BitWriter();
        w.put(2, h.fscod);
        w.put(5, h.bsid);
        w.put(3, h.bsmod);
        w.put(3, h.acmod);
        w.put(1, h.lfeon);
        w.put(5, h.bitrateCode);
        w.put(5, 0);
        return box('dac3', w.done());
    }

    /* ---------------- AAC ---------------- */

    var AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

    function aacConfig(priv, rate, channels, codecId) {
        if (priv && priv.length >= 2) { return priv; }
        /* A_AAC/MPEG4/LC gibi CodecPrivate'siz eski kayitlar */
        var obj = /SBR/.test(codecId) ? 5 : (/MAIN/.test(codecId) ? 1 : 2);
        var idx = AAC_RATES.indexOf(rate);
        if (idx < 0) { idx = 3; }
        return new Uint8Array([(obj << 3) | (idx >> 1), ((idx & 1) << 7) | (channels << 3)]);
    }

    function esdsBox(asc, trackId) {
        function desc(tag, body) { return concat([u8(tag), u8(body.length), body]); }
        var dsi = desc(5, asc);
        var dcd = desc(4, concat([u8(0x40), u8(0x15), zeros(3), u32(0), u32(0), dsi]));
        var esd = desc(3, concat([u16(trackId), u8(0), dcd, desc(6, u8(2))]));
        return fullBox('esds', 0, 0, esd);
    }

    /* ---------------- Ornek girdileri (stsd) ---------------- */

    function visualEntry(type, w, h, configBox) {
        return box(type, zeros(6), u16(1), zeros(16), u16(w), u16(h),
                   u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32),
                   u16(0x18), u16(0xFFFF), configBox);
    }

    function audioEntry(type, channels, rate, configBox) {
        return box(type, zeros(6), u16(1), zeros(8), u16(channels), u16(16),
                   u16(0), u16(0), u32((rate & 0xFFFF) * 65536), configBox);
    }

    function hex2(v) { return ('0' + v.toString(16)).slice(-2); }

    /** hvcC'den RFC 6381 kodek adi (hvc1.1.6.L120.90 gibi) */
    function hevcCodecString(c) {
        var space = (c[1] >> 6) & 3;
        var tier = (c[1] >> 5) & 1;
        var profile = c[1] & 0x1F;
        var compat = ((c[2] << 24) | (c[3] << 16) | (c[4] << 8) | c[5]) >>> 0;
        var rev = 0;
        for (var i = 0; i < 32; i++) { rev = (rev * 2) + ((compat >>> i) & 1); }
        var cons = [];
        for (var j = 6; j < 12; j++) { cons.push(c[j]); }
        while (cons.length && !cons[cons.length - 1]) { cons.pop(); }
        var s = 'hvc1.' + (space ? String.fromCharCode(64 + space) : '') + profile + '.' +
                rev.toString(16).toUpperCase() + '.' + (tier ? 'H' : 'L') + c[12];
        for (var k = 0; k < cons.length; k++) { s += '.' + cons[k].toString(16).toUpperCase(); }
        return s;
    }

    /**
     * MKV parcasi icin MSE bilgisi. Ses parcalarinda ilk kare gerekir
     * (Dolby ayarlari karenin basligindan okunur).
     * @param {object} t player/mkv.js parca nesnesi
     * @param {Uint8Array} [firstFrame] ses icin ilk kare
     * @returns {object|null} {kind, mime, timescale, entry, frameDur90}
     */
    function codecFor(t, firstFrame) {
        var c = t.codec || '';
        if (t.unsupportedEncoding) { return null; }
        if (c === 'V_MPEG4/ISO/AVC' && t.priv && t.priv.length > 6) {
            return {
                kind: 'video',
                mime: 'video/mp4; codecs="avc1.' + hex2(t.priv[1]) + hex2(t.priv[2]) + hex2(t.priv[3]) + '"',
                timescale: 90000,
                entry: visualEntry('avc1', t.width, t.height, box('avcC', t.priv))
            };
        }
        if (c === 'V_MPEGH/ISO/HEVC' && t.priv && t.priv.length > 22) {
            return {
                kind: 'video',
                mime: 'video/mp4; codecs="' + hevcCodecString(t.priv) + '"',
                timescale: 90000,
                entry: visualEntry('hvc1', t.width, t.height, box('hvcC', t.priv))
            };
        }
        if (c === 'A_EAC3') {
            var info = { kind: 'audio', mime: 'audio/mp4; codecs="ec-3"', timescale: t.rate || 48000, needsFrame: true };
            if (firstFrame) {
                var h = eac3Header(firstFrame, 0);
                if (!h) { return null; }
                var deps = 0;
                var p = h.size;
                while (p + 6 < firstFrame.length) {
                    var d = eac3Header(firstFrame, p);
                    if (!d) { break; }
                    if (d.strmtyp === 1) { deps++; }
                    p += d.size;
                }
                var kbps = Math.round(firstFrame.length * 8 * h.rate / h.samples / 1000);
                info.timescale = h.rate;
                info.entry = audioEntry('ec-3', ACMOD_CH[h.acmod] + h.lfeon, h.rate, dec3Box(h, deps, kbps));
            }
            return info;
        }
        if (c === 'A_AC3') {
            var a = { kind: 'audio', mime: 'audio/mp4; codecs="ac-3"', timescale: t.rate || 48000, needsFrame: true };
            if (firstFrame) {
                var ah = ac3Header(firstFrame, 0);
                if (!ah) { return null; }
                a.timescale = ah.rate;
                a.entry = audioEntry('ac-3', ACMOD_CH[ah.acmod] + ah.lfeon, ah.rate, dac3Box(ah));
            }
            return a;
        }
        if (c.indexOf('A_AAC') === 0) {
            var asc = aacConfig(t.priv, t.rate, t.channels, c);
            var obj = asc[0] >> 3;
            var ridx = ((asc[0] & 7) << 1) | (asc[1] >> 7);
            var rate = AAC_RATES[ridx] || t.rate || 48000;
            return {
                kind: 'audio',
                mime: 'audio/mp4; codecs="mp4a.40.' + obj + '"',
                timescale: rate,
                entry: audioEntry('mp4a', t.channels || 2, rate, esdsBox(asc, 1))
            };
        }
        return null;
    }

    /**
     * Ses karesini MP4 orneklerine bol: Dolby'de bir MKV karesi birden
     * cok cerceve tasiyabilir (bagimli alt akislar ayni ornege girer).
     * @returns {Array<{data, samples}>}
     */
    function splitAudio(codec, data) {
        var out = [];
        var p = 0;
        var h;
        if (codec === 'A_EAC3') {
            var cur = null;
            while (p + 6 <= data.length) {
                h = eac3Header(data, p);
                if (!h || p + h.size > data.length) { break; }
                if (h.strmtyp !== 1 || !cur) {
                    cur = { start: p, end: p + h.size, samples: h.samples };
                    out.push(cur);
                } else {
                    cur.end = p + h.size;
                }
                p += h.size;
            }
        } else if (codec === 'A_AC3') {
            while (p + 6 <= data.length) {
                h = ac3Header(data, p);
                if (!h || !h.size || p + h.size > data.length) { break; }
                out.push({ start: p, end: p + h.size, samples: 1536 });
                p += h.size;
            }
        }
        if (!out.length) {
            return [{ data: data, samples: codec === 'A_EAC3' || codec === 'A_AC3' ? 1536 : 1024 }];
        }
        var res = [];
        for (var i = 0; i < out.length; i++) {
            res.push({ data: data.subarray(out[i].start, out[i].end), samples: out[i].samples });
        }
        return res;
    }

    /* ---------------- Parcalar ---------------- */

    /** Baslangic parcasi: tek parcali (her SourceBuffer'a ayri) */
    function initSegment(info, trackId) {
        var video = info.kind === 'video';
        var w = video ? (info.width || 0) : 0;
        var h = video ? (info.height || 0) : 0;
        var tkhd = fullBox('tkhd', 0, 7, u32(0), u32(0), u32(trackId), u32(0), u32(0),
                           zeros(8), u16(0), u16(0), u16(video ? 0 : 0x0100), u16(0),
                           MATRIX, u32(w * 65536), u32(h * 65536));
        var mdhd = fullBox('mdhd', 0, 0, u32(0), u32(0), u32(info.timescale), u32(0), u16(0x55C4), u16(0));
        var hdlr = fullBox('hdlr', 0, 0, u32(0), ascii(video ? 'vide' : 'soun'), zeros(12),
                           ascii(video ? 'VideoHandler' : 'SoundHandler'), u8(0));
        var mediaHeader = video ? fullBox('vmhd', 0, 1, zeros(8)) : fullBox('smhd', 0, 0, zeros(4));
        var dinf = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)));
        var stbl = box('stbl',
            fullBox('stsd', 0, 0, u32(1), info.entry),
            fullBox('stts', 0, 0, u32(0)),
            fullBox('stsc', 0, 0, u32(0)),
            fullBox('stsz', 0, 0, u32(0), u32(0)),
            fullBox('stco', 0, 0, u32(0)));
        var trak = box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', mediaHeader, dinf, stbl)));
        var mvhd = fullBox('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(0), u32(0x00010000),
                           u16(0x0100), zeros(10), MATRIX, zeros(24), u32(trackId + 1));
        var mvex = box('mvex', fullBox('trex', 0, 0, u32(trackId), u32(1), u32(0), u32(0), u32(0)));
        var ftyp = box('ftyp', ascii('isom'), u32(0x200), ascii('isom'), ascii('iso6'), ascii('mp41'));
        return concat([ftyp, box('moov', mvhd, trak, mvex)]);
    }

    /**
     * Medya parcasi.
     * @param {Array<{data, dur, cto, key}>} samples cozme sirasinda
     * @param {number} baseTime ilk ornegin cozme zamani (parca zaman olceginde)
     */
    function mediaSegment(trackId, seq, baseTime, samples) {
        var n = samples.length;
        var negative = false;
        var i;
        for (i = 0; i < n; i++) { if (samples[i].cto < 0) { negative = true; break; } }

        /* trun: veri konumu + sure + boyut + bayrak + gosterim farki */
        var rows = [];
        var total = 0;
        for (i = 0; i < n; i++) {
            var s = samples[i];
            total += s.data.length;
            rows.push(u32(s.dur), u32(s.data.length),
                      u32(s.key ? 0x02000000 : 0x01010000),
                      negative ? i32(s.cto) : u32(s.cto));
        }
        var trunBody = concat(rows);
        /* moof boyutunu bilmeden data_offset yazilamaz: once 0 ile kur */
        function build(dataOffset) {
            var trun = fullBox('trun', negative ? 1 : 0, 0x000F01, u32(n), u32(dataOffset), trunBody);
            var traf = box('traf',
                fullBox('tfhd', 0, 0x020000, u32(trackId)),
                fullBox('tfdt', 1, 0, u64(baseTime)),
                trun);
            return box('moof', fullBox('mfhd', 0, 0, u32(seq)), traf);
        }
        var moof = build(0);
        moof = build(moof.length + 8);

        var mdat = new Uint8Array(total + 8);
        mdat.set(u32(total + 8), 0);
        mdat.set(ascii('mdat'), 4);
        var p = 8;
        for (i = 0; i < n; i++) { mdat.set(samples[i].data, p); p += samples[i].data.length; }
        return concat([moof, mdat]);
    }

    App.Fmp4 = {
        codecFor: codecFor,
        splitAudio: splitAudio,
        initSegment: initSegment,
        mediaSegment: mediaSegment,
        eac3Header: eac3Header,
        ac3Header: ac3Header,
        hevcCodecString: hevcCodecString
    };
})(window.App = window.App || {});
