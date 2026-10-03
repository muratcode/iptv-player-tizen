/* ============================================================
   player/mkv.js
   Matroska (MKV) cozumleyici - player/mse.js icin.

   TV'nin oynaticilari bazi MKV dosyalarinda sarma dizinini (Cues)
   bulamiyor (bkz. player/seekcheck.js). Bu dosyalari oynatmak icin
   uygulama dosyayi KENDISI okur: bu modul basliktan parca listesini,
   dosya sonundaki sarma dizinini ve kume (Cluster) icindeki goruntu /
   ses / altyazi karelerini cikarir.

   - Saf ES5 + Uint8Array/DataView; harici bagimlilik yok.
   - Tum konumlar dosya basina gore MUTLAK bayttir; Matroska'daki
     "segment'e gore" konumlar segStart eklenerek cevrilir.
   - Kumeler parca parca (Range istekleriyle) gelir: Demuxer akisi
     besleme (push) ile calisir, yarim kalan eleman bir sonraki parcayi
     bekler.
   ============================================================ */
(function (App) {
    'use strict';

    var ID = {
        EBML: 0x1A45DFA3,
        SEGMENT: 0x18538067,
        SEEKHEAD: 0x114D9B74, SEEK: 0x4DBB, SEEKID: 0x53AB, SEEKPOS: 0x53AC,
        INFO: 0x1549A966, TIMESCALE: 0x2AD7B1, DURATION: 0x4489,
        TRACKS: 0x1654AE6B, TRACKENTRY: 0xAE, TRACKNUMBER: 0xD7, TRACKTYPE: 0x83,
        FLAGENABLED: 0xB9, FLAGDEFAULT: 0x88, FLAGFORCED: 0x55AA, DEFAULTDURATION: 0x23E383,
        NAME: 0x536E, LANGUAGE: 0x22B59C, LANGUAGEBCP47: 0x22B59D,
        CODECID: 0x86, CODECPRIVATE: 0x63A2, CODECDELAY: 0x56AA,
        VIDEO: 0xE0, PIXELWIDTH: 0xB0, PIXELHEIGHT: 0xBA, DISPLAYWIDTH: 0x54B0, DISPLAYHEIGHT: 0x54BA,
        AUDIO: 0xE1, SAMPLINGFREQ: 0xB5, OUTSAMPLINGFREQ: 0x78B5, CHANNELS: 0x9F, BITDEPTH: 0x6264,
        CONTENTENCODINGS: 0x6D80, CONTENTENCODING: 0x6240, CONTENTCOMPRESSION: 0x5034,
        CONTENTCOMPALGO: 0x4254, CONTENTCOMPSETTINGS: 0x4255, CONTENTENCRYPTION: 0x5035,
        CLUSTER: 0x1F43B675, TIMECODE: 0xE7, SIMPLEBLOCK: 0xA3, BLOCKGROUP: 0xA0,
        BLOCK: 0xA1, BLOCKDURATION: 0x9B, REFERENCEBLOCK: 0xFB,
        CUES: 0x1C53BB6B, CUEPOINT: 0xBB, CUETIME: 0xB3, CUETRACKPOS: 0xB7,
        CUETRACK: 0xF7, CUECLUSTERPOS: 0xF1, CUERELPOS: 0xF0,
        TAGS: 0x1254C367, CHAPTERS: 0x1043A770, ATTACHMENTS: 0x1941A469,
        VOID: 0xEC, CRC32: 0xBF
    };

    /* Segment'in ust duzey cocuklari: bilinmeyen boyutlu bir kumenin
       nerede bittigini bunlardan anlariz. */
    var TOP_LEVEL = {};
    TOP_LEVEL[ID.CLUSTER] = 1; TOP_LEVEL[ID.CUES] = 1; TOP_LEVEL[ID.TAGS] = 1;
    TOP_LEVEL[ID.SEEKHEAD] = 1; TOP_LEVEL[ID.INFO] = 1; TOP_LEVEL[ID.TRACKS] = 1;
    TOP_LEVEL[ID.CHAPTERS] = 1; TOP_LEVEL[ID.ATTACHMENTS] = 1;

    var UNKNOWN = -1;

    /* ---------------- EBML okuma ---------------- */

    /**
     * Degisken uzunluklu tamsayi.
     * @param {boolean} keepMarker kimlik (ID) okurken isaret biti kalir
     * @returns {{v:number,len:number}|null} null: veri yetmedi / gecersiz.
     *          Boyut "bilinmiyor" ise v = UNKNOWN.
     */
    function vint(b, p, keepMarker) {
        if (p >= b.length) { return null; }
        var first = b[p];
        if (!first) { return { v: 0, len: 0, bad: true }; }
        var len = 1;
        var mask = 0x80;
        while (!(first & mask)) { len++; mask >>= 1; }
        if (p + len > b.length) { return null; }
        var v = keepMarker ? first : (first & (mask - 1));
        var allOnes = !keepMarker && v === mask - 1;
        for (var i = 1; i < len; i++) {
            v = v * 256 + b[p + i];
            if (b[p + i] !== 0xFF) { allOnes = false; }
        }
        if (allOnes) { v = UNKNOWN; }
        return { v: v, len: len };
    }

    /** Eleman basligi: {id, size, data (veri baslangici), end} - null: yetmedi */
    function header(b, p) {
        var id = vint(b, p, true);
        if (!id) { return null; }
        if (id.bad) { return { bad: true }; }
        var sz = vint(b, p + id.len, false);
        if (!sz) { return null; }
        if (sz.bad) { return { bad: true }; }
        var data = p + id.len + sz.len;
        return { id: id.v, size: sz.v, data: data, end: sz.v === UNKNOWN ? UNKNOWN : data + sz.v };
    }

    function uint(b, p, n) {
        var v = 0;
        for (var i = 0; i < n; i++) { v = v * 256 + b[p + i]; }
        return v;
    }

    function float(b, p, n) {
        var dv = new DataView(b.buffer, b.byteOffset + p, n);
        return n === 4 ? dv.getFloat32(0) : (n === 8 ? dv.getFloat64(0) : 0);
    }

    function str(b, p, n) {
        var s = '';
        for (var i = 0; i < n; i++) {
            var c = b[p + i];
            if (!c) { break; }
            s += String.fromCharCode(c);
        }
        try { return decodeURIComponent(escape(s)); } catch (e) { return s; }   /* UTF-8 */
    }

    /** [start, end) icindeki cocuklar icin fn(h) - tam olmayan son eleman atlanir */
    function each(b, start, end, fn) {
        var p = start;
        while (p < end) {
            var h = header(b, p);
            if (!h || h.bad || h.end === UNKNOWN || h.end > b.length) { return; }
            fn(h);
            p = h.end;
        }
    }

    /* ---------------- Baslik bolumleri ---------------- */

    function parseSeekHead(b, h, segStart) {
        var out = [];
        each(b, h.data, h.end, function (s) {
            if (s.id !== ID.SEEK) { return; }
            var id = 0;
            var pos = -1;
            each(b, s.data, s.end, function (f) {
                if (f.id === ID.SEEKID) { id = uint(b, f.data, f.size); }
                if (f.id === ID.SEEKPOS) { pos = uint(b, f.data, f.size); }
            });
            if (id && pos >= 0) { out.push({ id: id, pos: segStart + pos }); }
        });
        return out;
    }

    function parseInfo(b, h) {
        var info = { timescale: 1000000, durationMs: 0 };
        var dur = 0;
        each(b, h.data, h.end, function (f) {
            if (f.id === ID.TIMESCALE) { info.timescale = uint(b, f.data, f.size) || 1000000; }
            if (f.id === ID.DURATION) { dur = float(b, f.data, f.size); }
        });
        info.durationMs = dur * info.timescale / 1e6;
        return info;
    }

    function parseTrack(b, h) {
        var t = {
            number: 0, type: 0, codec: '', priv: null, lang: 'eng', name: '',
            enabled: true, isDefault: true, forced: false, defaultDurationNs: 0,
            width: 0, height: 0, rate: 0, channels: 1, bits: 0,
            strip: null, unsupportedEncoding: false
        };
        each(b, h.data, h.end, function (f) {
            switch (f.id) {
                case ID.TRACKNUMBER: t.number = uint(b, f.data, f.size); break;
                case ID.TRACKTYPE: t.type = uint(b, f.data, f.size); break;
                case ID.FLAGENABLED: t.enabled = !!uint(b, f.data, f.size); break;
                case ID.FLAGDEFAULT: t.isDefault = !!uint(b, f.data, f.size); break;
                case ID.FLAGFORCED: t.forced = !!uint(b, f.data, f.size); break;
                case ID.DEFAULTDURATION: t.defaultDurationNs = uint(b, f.data, f.size); break;
                case ID.NAME: t.name = str(b, f.data, f.size); break;
                case ID.LANGUAGE: t.lang = str(b, f.data, f.size) || 'und'; break;
                case ID.CODECID: t.codec = str(b, f.data, f.size); break;
                case ID.CODECPRIVATE: t.priv = b.slice(f.data, f.end); break;
                case ID.VIDEO:
                    each(b, f.data, f.end, function (v) {
                        if (v.id === ID.PIXELWIDTH) { t.width = uint(b, v.data, v.size); }
                        if (v.id === ID.PIXELHEIGHT) { t.height = uint(b, v.data, v.size); }
                    });
                    break;
                case ID.AUDIO:
                    each(b, f.data, f.end, function (a) {
                        if (a.id === ID.SAMPLINGFREQ) { t.rate = Math.round(float(b, a.data, a.size)); }
                        if (a.id === ID.OUTSAMPLINGFREQ) { t.outRate = Math.round(float(b, a.data, a.size)); }
                        if (a.id === ID.CHANNELS) { t.channels = uint(b, a.data, a.size); }
                        if (a.id === ID.BITDEPTH) { t.bits = uint(b, a.data, a.size); }
                    });
                    break;
                case ID.CONTENTENCODINGS:
                    /* Yalnizca "baslik soyma" (algo 3) desteklenir: her karenin
                       basina sabit baytlar eklenir. zlib/sifreleme -> desteklenmez. */
                    each(b, f.data, f.end, function (e) {
                        if (e.id !== ID.CONTENTENCODING) { return; }
                        each(b, e.data, e.end, function (c) {
                            if (c.id === ID.CONTENTENCRYPTION) { t.unsupportedEncoding = true; }
                            if (c.id !== ID.CONTENTCOMPRESSION) { return; }
                            var algo = 0;
                            var settings = null;
                            each(b, c.data, c.end, function (x) {
                                if (x.id === ID.CONTENTCOMPALGO) { algo = uint(b, x.data, x.size); }
                                if (x.id === ID.CONTENTCOMPSETTINGS) { settings = b.slice(x.data, x.end); }
                            });
                            if (algo === 3 && settings) { t.strip = settings; }
                            else { t.unsupportedEncoding = true; }
                        });
                    });
                    break;
            }
        });
        if (t.outRate) { t.rate = t.outRate; }      /* HE-AAC (SBR) */
        return t;
    }

    function parseTracks(b, h) {
        var out = [];
        each(b, h.data, h.end, function (e) {
            if (e.id === ID.TRACKENTRY) { out.push(parseTrack(b, e)); }
        });
        return out;
    }

    /**
     * Sarma dizini.
     * @returns {Array<{ms:number, pos:number, rel:number}>} zamana gore sirali;
     *          pos: kumenin mutlak konumu
     */
    function parseCues(b, h, segStart, timescale, videoTrack) {
        var video = [];
        var other = [];
        var scale = (timescale || 1000000) / 1e6;
        each(b, h.data, h.end, function (cp) {
            if (cp.id !== ID.CUEPOINT) { return; }
            var time = -1;
            var vpos = null;
            var opos = null;
            each(b, cp.data, cp.end, function (f) {
                if (f.id === ID.CUETIME) { time = uint(b, f.data, f.size); }
                if (f.id !== ID.CUETRACKPOS) { return; }
                var tr = 0;
                var pos = -1;
                var rel = -1;
                each(b, f.data, f.end, function (g) {
                    if (g.id === ID.CUETRACK) { tr = uint(b, g.data, g.size); }
                    if (g.id === ID.CUECLUSTERPOS) { pos = uint(b, g.data, g.size); }
                    if (g.id === ID.CUERELPOS) { rel = uint(b, g.data, g.size); }
                });
                if (pos < 0) { return; }
                if (tr === videoTrack) { vpos = { pos: pos, rel: rel }; }
                else if (!opos) { opos = { pos: pos, rel: rel }; }
            });
            if (time < 0) { return; }
            if (vpos) { video.push({ ms: time * scale, pos: segStart + vpos.pos, rel: vpos.rel }); }
            else if (opos) { other.push({ ms: time * scale, pos: segStart + opos.pos, rel: opos.rel }); }
        });
        /* Yalnizca goruntu parcasinin noktalari anahtar kareye denk gelir;
           altyazi noktalari ancak goruntu noktasi hic yoksa kullanilir. */
        var out = video.length ? video : other;
        out.sort(function (a, c) { return a.ms - c.ms; });
        return out;
    }

    /**
     * Dosyanin basini coz: EBML + Segment + ilk SeekHead + (varsa) Info/Tracks.
     * @param {Uint8Array} b dosyanin ilk baytlari (64 KB yeterli olur)
     * @returns {object} {segStart, seeks:[{id,pos}], info, tracks, firstCluster}
     */
    function parseHead(b) {
        var res = { segStart: -1, seeks: [], info: null, tracks: null, firstCluster: -1 };
        var p = 0;
        var top = header(b, p);
        if (!top || top.id !== ID.EBML) { throw new Error('MKV degil (EBML basligi yok)'); }
        p = top.end;
        var seg = header(b, p);
        if (!seg || seg.id !== ID.SEGMENT) { throw new Error('Segment bulunamadi'); }
        res.segStart = seg.data;

        p = seg.data;
        while (p < b.length) {
            var h = header(b, p);
            if (!h || h.bad) { break; }
            if (h.id === ID.CLUSTER) { res.firstCluster = p; break; }
            if (h.end === UNKNOWN || h.end > b.length) {
                /* Tam okunamayan eleman: yeri yine de not al */
                if (h.id === ID.TRACKS || h.id === ID.INFO) { res.seeks.push({ id: h.id, pos: p, partial: true }); }
                if (h.end === UNKNOWN) { break; }
                p = h.end;
                continue;
            }
            if (h.id === ID.SEEKHEAD) { res.seeks = res.seeks.concat(parseSeekHead(b, h, res.segStart)); }
            else if (h.id === ID.INFO) { res.info = parseInfo(b, h); }
            else if (h.id === ID.TRACKS) { res.tracks = parseTracks(b, h); }
            else if (h.id === ID.CUES) { res.cuesAt = p; }
            p = h.end;
        }
        return res;
    }

    /** Tek bir ust duzey eleman (konumdan okunmus baytlar): {h, b} */
    function element(b) {
        var h = header(b, 0);
        if (!h || h.bad) { throw new Error('gecersiz eleman'); }
        return h;
    }

    /* ---------------- Kume (Cluster) akisi ---------------- */

    /**
     * Kumeleri parca parca cozer.
     * @param {object} opts {tracks: {sayi: true} istenen parcalar, timescale,
     *                       onFrame(frame), onEnd()}
     * frame: {track, ms (sunum zamani), durMs (0: bilinmiyor), key, data}
     */
    function Demuxer(opts) {
        this.opts = opts;
        this.buf = new Uint8Array(0);
        this.base = 0;            /* buf[0]'in dosyadaki mutlak konumu */
        this.pos = 0;             /* sonraki okunacak mutlak konum */
        this.clusterEnd = -2;     /* -2: kume disinda, UNKNOWN: boyutsuz kume */
        this.clusterTime = 0;
        this.ended = false;
        this.scale = (opts.timescale || 1000000) / 1e6;
    }

    /** Akisi verilen mutlak konumdan (bir kume basi) yeniden baslat */
    Demuxer.prototype.reset = function (absPos) {
        this.buf = new Uint8Array(0);
        this.base = absPos;
        this.pos = absPos;
        this.clusterEnd = -2;
        this.ended = false;
    };

    /** @param {Uint8Array} chunk  @param {number} absStart chunk'in mutlak konumu */
    Demuxer.prototype.push = function (chunk, absStart) {
        if (this.ended) { return; }
        var have = this.base + this.buf.length;
        if (absStart !== have) {
            /* Atlanan bolumden sonra (ornek: Void) yeni parca */
            if (absStart > have && this.pos >= absStart) {
                this.buf = new Uint8Array(0);
                this.base = absStart;
            } else if (absStart > have) {
                return;                       /* bosluk: cagiran yanlis konum istedi */
            } else {
                chunk = chunk.subarray(have - absStart);   /* ortusen kisim */
            }
        }
        /* Okunan kismi at, yenisini ekle */
        var keepFrom = Math.max(0, Math.min(this.pos - this.base, this.buf.length));
        var rest = this.buf.subarray(keepFrom);
        var nb = new Uint8Array(rest.length + chunk.length);
        nb.set(rest, 0);
        nb.set(chunk, rest.length);
        this.base += keepFrom;
        this.buf = nb;
        this._run();
    };

    /** Okunmasi beklenen sonraki mutlak konum (atlanan elemanlar dahil) */
    Demuxer.prototype.wantPos = function () {
        return Math.max(this.pos, this.base + this.buf.length);
    };

    Demuxer.prototype._run = function () {
        var b = this.buf;
        for (;;) {
            if (this.ended) { return; }
            var rel = this.pos - this.base;
            if (rel < 0 || rel >= b.length) { return; }

            /* Kume bitti mi? */
            if (this.clusterEnd !== -2 && this.clusterEnd !== UNKNOWN && this.pos >= this.clusterEnd) {
                this.clusterEnd = -2;
            }

            var h = header(b, rel);
            if (!h) { return; }                                   /* baslik yarim */
            if (h.bad) { this._end(); return; }

            var abs = this.pos;
            if (this.clusterEnd === -2 || (this.clusterEnd === UNKNOWN && TOP_LEVEL[h.id])) {
                /* Ust duzey */
                this.clusterEnd = -2;
                if (h.id === ID.CLUSTER) {
                    this.clusterEnd = h.end === UNKNOWN ? UNKNOWN : abs + (h.end - rel);
                    this.pos = abs + (h.data - rel);
                    continue;
                }
                if (h.id === ID.CUES || h.id === ID.TAGS || h.id === ID.SEEKHEAD ||
                    h.id === ID.CHAPTERS || h.id === ID.ATTACHMENTS) {
                    this._end();                                 /* medya bitti */
                    return;
                }
                if (h.end === UNKNOWN) { this._end(); return; }
                this.pos = abs + (h.end - rel);                   /* Void vb. atla */
                continue;
            }

            /* Kume ici */
            if (h.end === UNKNOWN) { this._end(); return; }
            if (h.id === ID.TIMECODE) {
                if (h.end > b.length) { return; }
                this.clusterTime = uint(b, h.data, h.size);
                this.pos = abs + (h.end - rel);
                continue;
            }
            if (h.id === ID.SIMPLEBLOCK || h.id === ID.BLOCKGROUP) {
                if (h.end > b.length) { return; }                 /* blok yarim: sonraki parca */
                if (h.id === ID.SIMPLEBLOCK) { this._block(b, h.data, h.end, true, 0, false); }
                else { this._group(b, h); }
                this.pos = abs + (h.end - rel);
                continue;
            }
            this.pos = abs + (h.end - rel);                       /* diger cocuklar */
        }
    };

    Demuxer.prototype._group = function (b, h) {
        var blk = null;
        var dur = 0;
        var hasRef = false;
        each(b, h.data, h.end, function (f) {
            if (f.id === ID.BLOCK) { blk = f; }
            if (f.id === ID.BLOCKDURATION) { dur = uint(b, f.data, f.size); }
            if (f.id === ID.REFERENCEBLOCK) { hasRef = true; }
        });
        if (blk) { this._block(b, blk.data, blk.end, false, dur, !hasRef); }
    };

    Demuxer.prototype._block = function (b, p, end, simple, durTicks, groupKey) {
        var tn = vint(b, p, false);
        if (!tn || tn.bad) { return; }
        var track = tn.v;
        if (!this.opts.tracks[track]) { return; }
        p += tn.len;
        var tc = (b[p] << 8) | b[p + 1];
        if (tc & 0x8000) { tc -= 0x10000; }
        var flags = b[p + 2];
        p += 3;
        var key = simple ? !!(flags & 0x80) : groupKey;
        var ms = (this.clusterTime + tc) * this.scale;
        var durMs = durTicks * this.scale;
        var lacing = (flags >> 1) & 3;

        if (!lacing) {
            this._emit(track, ms, durMs, key, b.subarray(p, end));
            return;
        }
        var n = b[p] + 1;
        p += 1;
        var sizes = [];
        var i;
        if (lacing === 1) {                     /* Xiph */
            for (i = 0; i < n - 1; i++) {
                var s = 0;
                while (b[p] === 255) { s += 255; p++; }
                s += b[p++];
                sizes.push(s);
            }
        } else if (lacing === 3) {              /* EBML */
            var first = vint(b, p, false);
            p += first.len;
            sizes.push(first.v);
            for (i = 1; i < n - 1; i++) {
                var d = vint(b, p, false);
                /* isaretli: deger - (2^(7*len-1) - 1) */
                var bias = Math.pow(2, 7 * d.len - 1) - 1;
                p += d.len;
                sizes.push(sizes[i - 1] + (d.v - bias));
            }
        }
        var used = 0;
        for (i = 0; i < sizes.length; i++) { used += sizes[i]; }
        if (lacing === 2) {                     /* sabit boy */
            var each1 = Math.floor((end - p) / n);
            sizes = [];
            for (i = 0; i < n - 1; i++) { sizes.push(each1); }
            used = each1 * (n - 1);
        }
        sizes.push(end - p - used);
        var per = durMs ? durMs / n : 0;
        for (i = 0; i < n; i++) {
            this._emit(track, ms + per * i, per, key && i === 0, b.subarray(p, p + sizes[i]));
            p += sizes[i];
        }
    };

    Demuxer.prototype._emit = function (track, ms, durMs, key, data) {
        var strip = this.opts.strip && this.opts.strip[track];
        if (strip) {
            var d = new Uint8Array(strip.length + data.length);
            d.set(strip, 0);
            d.set(data, strip.length);
            data = d;
        }
        this.opts.onFrame({ track: track, ms: ms, durMs: durMs, key: key, data: data });
    };

    Demuxer.prototype._end = function () {
        if (this.ended) { return; }
        this.ended = true;
        if (this.opts.onEnd) { this.opts.onEnd(); }
    };

    App.Mkv = {
        ID: ID,
        UNKNOWN: UNKNOWN,
        header: header,
        element: element,
        parseHead: parseHead,
        parseSeekHead: parseSeekHead,
        parseInfo: parseInfo,
        parseTracks: parseTracks,
        parseCues: parseCues,
        Demuxer: Demuxer
    };
})(window.App = window.App || {});
