/* ============================================================
   player/mse.js
   Media Source (MSE) ile MKV oynatici.

   NEDEN
   -----
   Bazi MKV dosyalarinda sarma dizini (Cues) dosyanin basindan dogrudan
   gosterilmez (bkz. player/seekcheck.js). Samsung AVPlay da HTML5
   <video> da bu dosyalarda sarama yapamaz: komut reddedilir, goruntu
   takilir. Dizin dosyada vardir, yalnizca sondadir.

   Bu oynatici dosyayi KENDISI okur:
     1. Basliktan parca listesini, sondan sarma dizinini alir (Range).
     2. Istenen konumun anahtar karesinden baslayarak dosyayi parca
        parca indirir (player/mkv.js ile kareleri cikarir).
     3. Kareleri MP4 parcalarina cevirip (player/fmp4.js) tarayicinin
        Media Source oynaticisina verir.
   Sarma: dizinden ilgili kumenin bayt konumu bulunur, oradan indirmeye
   devam edilir. Dosyanin icindeki metin altyazilar (SRT/ASS) da okunur.

   Diger oynaticilarla (avplay.js, html5.js) AYNI arayuzu sunar;
   player/controller.js yalnizca bu tur dosyalarda bunu secer.

   SINIRLAR
   --------
   - Hesap tek baglantili olabilir: istekler hic paralel atilmaz.
   - Yalnizca H.264/H.265 + E-AC-3/AC-3/AAC (bkz. fmp4.js codecFor).
     Desteklenmeyen dosyada prepare() hata verir; controller AVPlay'e
     doner.
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('MSE');

    var HEAD_BYTES = 65536;
    var CHUNK_FIRST = 1024 * 1024;     /* sarmadan sonra hizli baslangic */
    var CHUNK = 3 * 1024 * 1024;       /* sonraki parcalar (~2 sn goruntu) */
    /* TV'nin SourceBuffer kotasi kucuk: 12 Mbit/sn'lik dosyada ~45 MB'ta
       (~33 sn) doldu (olculdu). Tampon bayt butcesine gore ayarlanir:
       geride ~13 sn (10 sn geri sarma bellekten, aninda olsun), kalan
       butce ileriye. Yine dolarsa ikisi de kucultulur (bkz. _pump). */
    var BUFFER_BUDGET = 40 * 1024 * 1024;
    var AHEAD_MS = 18000;              /* en fazla bu kadar ileriyi tamponda tut */
    var AHEAD_MIN_MS = 6000;
    var BEHIND_MS = 13000;             /* bundan eskisini sil */
    var BEHIND_MIN_MS = 3000;
    var FETCH_TRIES = 4;
    var SEEK_TIMEOUT_MS = 25000;
    var REORDER_FRAMES = 2;            /* B-kare icin cozme zamani payi */
    /* Tum zaman cizelgesi bu kadar ileri kaydirilir: dosyanin en basinda
       B-kareler yuzunden cozme zamani eksiye dusmesin (MP4 yazamaz).
       Ses ve goruntu birlikte kayar; disariya duzeltilmis zaman verilir. */
    var OFFSET_MS = 250;

    var SUB_CODECS = { 'S_TEXT/UTF8': 1, 'S_TEXT/ASS': 1, 'S_TEXT/SSA': 1, 'S_TEXT/WEBVTT': 1 };

    function el() { return document.getElementById('mse-player'); }

    function MsePlayer() {
        this.name = 'mse';
        this.el = el();
        this.handlers = {};
        this.lastSeekFail = '';
        this.isLive = false;
        this._session = 0;
        this._reset();
        this._bound = false;
    }

    MsePlayer.isAvailable = function () {
        return !!(window.MediaSource && el() && window.URL && URL.createObjectURL);
    };

    MsePlayer.prototype._reset = function () {
        this.prepared = false;
        this.url = '';
        this.finalUrl = '';
        this.size = 0;
        this.head = null;
        this.info = null;
        this.tracks = [];
        this.cues = [];
        this.video = null;              /* {track, info} */
        this.audio = null;              /* {track, info} (info ilk karede tamamlanir) */
        this.audioTrack = 0;
        this.subTracks = [];
        this.subTrack = 0;
        this.subHidden = true;
        this.subs = {};                 /* parca no -> [{s, e, text}] */
        this.subShown = null;
        this.ms = null;
        this.objUrl = '';
        this.sb = {};                   /* video / audio SourceBuffer + kuyruk */
        this.stream = null;             /* etkin indirme akisi */
        this.eos = false;
        this.bandwidth = 0;
        this.seekWaiters = [];
        this.aheadMs = AHEAD_MS;
        this.behindMs = BEHIND_MS;
    };

    MsePlayer.prototype.setHandlers = function (h) { this.handlers = h || {}; };
    MsePlayer.prototype.isBusy = function () { return false; };

    MsePlayer.prototype._fire = function (name) {
        var fn = this.handlers[name];
        if (typeof fn !== 'function') { return; }
        var args = Array.prototype.slice.call(arguments, 1);
        try { fn.apply(null, args); } catch (e) { log.error('handler ' + name, e && e.message); }
    };

    /* ---------------- Ag ---------------- */

    /** Range istegi; tek seferde tek istek. @returns {Promise<Uint8Array>} */
    MsePlayer.prototype._range = function (from, to, session) {
        var self = this;
        var tries = 0;
        function once(useFinal) {
            return new Promise(function (resolve, reject) {
                var x = new XMLHttpRequest();
                var url = (useFinal && self.finalUrl) || self.url;
                var t0 = Date.now();
                self._xhr = x;
                x.open('GET', url, true);
                x.responseType = 'arraybuffer';
                x.timeout = 20000;
                x.setRequestHeader('Range', 'bytes=' + from + '-' + to);
                x.onreadystatechange = function () {
                    /* Range'i yok sayan sunucu tum dosyayi gonderir: hemen kes */
                    if (x.readyState === 2 && x.status !== 206) {
                        try { x.abort(); } catch (e) { }
                        reject({ status: x.status });
                    }
                };
                x.onload = function () {
                    if (x.status !== 206) { return; }
                    if (x.responseURL && x.responseURL !== self.url) { self.finalUrl = x.responseURL; }
                    var cr = x.getResponseHeader('Content-Range') || '';
                    var total = parseInt(cr.split('/')[1], 10);
                    if (total > 0) { self.size = total; }
                    var b = new Uint8Array(x.response);
                    var dt = Date.now() - t0;
                    if (dt > 0 && b.length > 200000) { self.bandwidth = Math.round(b.length * 8000 / dt); }
                    resolve(b);
                };
                x.onerror = function () { reject({ status: 0 }); };
                x.ontimeout = function () { reject({ status: 0, timeout: true }); };
                x.onabort = function () { reject({ aborted: true }); };
                x.send();
            });
        }
        function attempt() {
            if (session !== self._session) { return Promise.reject({ aborted: true }); }
            return once(tries === 0 || tries === 2).then(null, function (err) {
                if (err && err.aborted) { throw err; }
                /* Kalici hatalar: tekrar denemenin anlami yok */
                if (err && (err.status === 404 || err.status === 416)) { throw err; }
                tries++;
                if (tries >= FETCH_TRIES || session !== self._session) { throw err; }
                /* Yonlendirilen adres suresi dolmus olabilir: asil adrese don */
                if (err && err.status >= 400) { self.finalUrl = ''; }
                log.warn('parca alinamadi, tekrar', tries, err && (err.status || (err.timeout ? 'zaman asimi' : 'ag')));
                return new Promise(function (r) { setTimeout(r, 800 * tries); }).then(attempt);
            });
        }
        return attempt();
    };

    /* ---------------- Baslik ve dizin ---------------- */

    MsePlayer.prototype._readElement = function (pos, session, minBytes) {
        var self = this;
        return this._range(pos, pos + (minBytes || 65535), session).then(function (b) {
            var h = App.Mkv.header(b, 0);
            if (!h || h.bad || h.end === App.Mkv.UNKNOWN) { throw new Error('eleman okunamadi'); }
            if (h.end <= b.length) { return b; }
            return self._range(pos, pos + h.end - 1, session);
        });
    };

    MsePlayer.prototype._loadHead = function (session) {
        var self = this;
        var M = App.Mkv;
        return this._range(0, HEAD_BYTES - 1, session).then(function (b) {
            var head = M.parseHead(b);
            self.head = head;
            var need = [];
            function seekPos(id) {
                for (var i = 0; i < head.seeks.length; i++) { if (head.seeks[i].id === id) { return head.seeks[i].pos; } }
                return -1;
            }
            /* Ikinci SeekHead (dosya sonunda) - Friends gibi dosyalarda dizin orada */
            var sh2 = seekPos(M.ID.SEEKHEAD);
            var chain = Promise.resolve();
            if (sh2 > 0) {
                chain = self._readElement(sh2, session, 4095).then(function (sb) {
                    var h2 = M.header(sb, 0);
                    head.seeks = head.seeks.concat(M.parseSeekHead(sb, h2, head.segStart));
                });
            }
            return chain.then(function () {
                if (!head.info) {
                    var ip = seekPos(M.ID.INFO);
                    if (ip > 0) {
                        need.push(self._readElement(ip, session).then(function (eb) {
                            head.info = M.parseInfo(eb, M.header(eb, 0));
                        }));
                    }
                }
                if (!head.tracks) {
                    var tp = seekPos(M.ID.TRACKS);
                    if (tp > 0) {
                        need.push(self._readElement(tp, session).then(function (eb) {
                            head.tracks = M.parseTracks(eb, M.header(eb, 0));
                        }));
                    }
                }
                /* Istekler sirayla (tek baglanti) */
                return need.reduce(function (p, f) { return p.then(function () { return f; }); }, Promise.resolve());
            }).then(function () {
                if (!head.tracks || !head.tracks.length) { throw new Error('parca listesi yok'); }
                self.info = head.info || { timescale: 1000000, durationMs: 0 };
                self.tracks = head.tracks;
                var cp = seekPos(M.ID.CUES);
                if (cp < 0 && head.cuesAt) { cp = head.cuesAt; }
                if (cp < 0) { throw new Error('sarma dizini yok'); }
                return self._readElement(cp, session, 262143).then(function (cb) {
                    var vt = self._pickVideo();
                    self.cues = M.parseCues(cb, M.header(cb, 0), head.segStart, self.info.timescale, vt ? vt.number : 0);
                    if (!self.cues.length) { throw new Error('sarma dizini bos'); }
                    if (!self.info.durationMs) {
                        self.info.durationMs = self.cues[self.cues.length - 1].ms + 2000;
                    }
                });
            });
        });
    };

    MsePlayer.prototype._pickVideo = function () {
        for (var i = 0; i < this.tracks.length; i++) {
            var t = this.tracks[i];
            if (t.type === 1 && t.enabled && App.Fmp4.codecFor(t)) { return t; }
        }
        return null;
    };

    function audioOk(t) {
        if (t.type !== 2 || !t.enabled) { return false; }
        var c = App.Fmp4.codecFor(t);
        return !!(c && window.MediaSource.isTypeSupported(c.mime));
    }

    /** Kayitli dil -> varsayilan isaretli -> ilk desteklenen */
    MsePlayer.prototype._pickAudio = function () {
        var want = String(App.Settings.get('preferredAudioLang') || '').toLowerCase();
        var list = [];
        for (var i = 0; i < this.tracks.length; i++) { if (audioOk(this.tracks[i])) { list.push(this.tracks[i]); } }
        if (!list.length) { return null; }
        var j;
        if (want) { for (j = 0; j < list.length; j++) { if (list[j].lang.toLowerCase() === want) { return list[j]; } } }
        for (j = 0; j < list.length; j++) { if (list[j].isDefault) { return list[j]; } }
        return list[0];
    };

    /* ---------------- Media Source ---------------- */

    MsePlayer.prototype._openSource = function (session) {
        var self = this;
        var vt = this._pickVideo();
        if (!vt) { return Promise.reject(new Error('desteklenen goruntu parcasi yok')); }
        var vinfo = App.Fmp4.codecFor(vt);
        vinfo.width = vt.width;
        vinfo.height = vt.height;
        if (!window.MediaSource.isTypeSupported(vinfo.mime)) {
            return Promise.reject(new Error('kodek desteklenmiyor: ' + vinfo.mime));
        }
        this.video = { track: vt, info: vinfo };
        var at = this._pickAudio();
        var hasAudio = false;
        for (var a = 0; a < this.tracks.length; a++) { if (this.tracks[a].type === 2) { hasAudio = true; } }
        if (hasAudio && !at) {
            /* Sessiz oynatmaktansa normal oynaticiya don (ornek: DTS ses) */
            return Promise.reject(new Error('desteklenen ses parcasi yok'));
        }
        if (at) {
            this.audio = { track: at, info: App.Fmp4.codecFor(at) };
            this.audioTrack = at.number;
        }
        this.subTracks = [];
        for (var i = 0; i < this.tracks.length; i++) {
            var t = this.tracks[i];
            if (t.type === 17 && SUB_CODECS[t.codec]) { this.subTracks.push(t); this.subs[t.number] = []; }
        }
        /* Tampon sinirlari: dosyanin ortalama bit hizina gore */
        var bps = (this.size && this.info.durationMs) ? this.size / (this.info.durationMs / 1000) : 0;
        if (bps > 0) {
            this.behindMs = Math.max(BEHIND_MIN_MS, Math.min(BEHIND_MS, BUFFER_BUDGET * 0.45 / bps * 1000));
            var left = BUFFER_BUDGET - this.behindMs / 1000 * bps;
            this.aheadMs = Math.max(AHEAD_MIN_MS, Math.min(AHEAD_MS, left / bps * 1000));
        }
        log.info('MSE: goruntu', vinfo.mime, '| ses', this.audio ? this.audio.info.mime + ' (' + at.lang + ')' : 'yok',
                 '| altyazi', this.subTracks.length, '| dizin', this.cues.length, 'nokta',
                 '| tampon ileri', Math.round(this.aheadMs / 1000) + ' sn, geri', Math.round(this.behindMs / 1000) + ' sn');

        return new Promise(function (resolve, reject) {
            var ms = new window.MediaSource();
            self.ms = ms;
            var done = false;
            var guard = setTimeout(function () {
                if (!done) { done = true; reject(new Error('MediaSource acilmadi')); }
            }, 8000);
            ms.addEventListener('sourceopen', function onOpen() {
                ms.removeEventListener('sourceopen', onOpen);
                if (done || session !== self._session) { return; }
                done = true;
                clearTimeout(guard);
                try {
                    ms.duration = (self.info.durationMs + OFFSET_MS) / 1000;
                    self._addBuffer('video', vinfo.mime);
                    if (self.audio) { self._addBuffer('audio', self.audio.info.mime); }
                    resolve();
                } catch (e) { reject(e); }
            });
            self.objUrl = URL.createObjectURL(ms);
            self.el.src = self.objUrl;
        });
    };

    MsePlayer.prototype._addBuffer = function (kind, mime) {
        var self = this;
        var buf = this.ms.addSourceBuffer(mime);
        var s = { kind: kind, buf: buf, q: [], mime: mime, inited: false, seq: 1 };
        this.sb[kind] = s;
        buf.addEventListener('updateend', function () { self._pump(s); });
        buf.addEventListener('error', function () { log.warn('SourceBuffer hatasi', kind); });
    };

    /** Kuyruktaki ekleme / silme islerini sirayla calistir */
    MsePlayer.prototype._pump = function (s) {
        if (!s || s.buf.updating || !s.q.length || !this.ms) { return; }
        if (this.ms.readyState === 'closed') { s.q = []; return; }
        var op = s.q[0];
        try {
            if (op.remove) {
                s.q.shift();
                var b = s.buf.buffered;
                var start = Math.max(op.start, 0);
                var end = op.end === Infinity ? Math.max(start + 1, this.ms.duration || 1e7) : op.end;
                if (b.length && end > start) { s.buf.remove(start, end); }
                else { this._pump(s); }
                return;
            }
            s.buf.appendBuffer(op.data);
            s.q.shift();
            if (op.cb) { op.cb(); }
        } catch (e) {
            if (e && e.name === 'QuotaExceededError') {
                /* Doldu: arkada kalani sil, sonra tekrar dene */
                var now = this.el.currentTime;
                this.aheadMs = Math.max(4000, Math.round(this.aheadMs * 0.75));
                this.behindMs = Math.max(2000, Math.round(this.behindMs * 0.75));
                log.warn('tampon dolu, eski kisim siliniyor; ileri', Math.round(this.aheadMs / 1000) + ' sn, geri',
                         Math.round(this.behindMs / 1000) + ' sn');
                s.q.unshift({ remove: true, start: 0, end: Math.max(0, now - 5) });
                var self = this;
                setTimeout(function () { self._pump(s); }, 500);
                return;
            }
            log.error('ekleme hatasi', s.kind, e && (e.name || e.message));
            s.q = [];
            this._fatal('PLAYER_ERROR_NOT_SUPPORTED_FILE', 'Bu dosya cozumlenemedi.');
        }
    };

    MsePlayer.prototype._enqueue = function (kind, data, cb) {
        var s = this.sb[kind];
        if (!s) { return; }
        s.q.push({ data: data, cb: cb });
        this._pump(s);
    };

    MsePlayer.prototype._queuedBytes = function () {
        var n = 0;
        for (var k in this.sb) {
            if (!this.sb.hasOwnProperty(k)) { continue; }
            for (var i = 0; i < this.sb[k].q.length; i++) { n += this.sb[k].q[i].data ? this.sb[k].q[i].data.length : 0; }
        }
        return n;
    };

    /** Su anki konumdan ileride tamponda kac ms var (en az olan SourceBuffer) */
    MsePlayer.prototype._aheadMs = function () {
        var t = this.el.currentTime;
        var min = Infinity;
        for (var k in this.sb) {
            if (!this.sb.hasOwnProperty(k)) { continue; }
            var b;
            try { b = this.sb[k].buf.buffered; } catch (e) { return 0; }
            var ahead = 0;
            for (var i = 0; i < b.length; i++) {
                if (b.start(i) <= t + 0.3 && b.end(i) > t) { ahead = b.end(i) - t; }
            }
            min = Math.min(min, ahead);
        }
        return min === Infinity ? 0 : min * 1000;
    };

    MsePlayer.prototype._inBuffer = function (sec) {
        for (var k in this.sb) {
            if (!this.sb.hasOwnProperty(k)) { continue; }
            var b = this.sb[k].buf.buffered;
            var ok = false;
            for (var i = 0; i < b.length; i++) {
                if (b.start(i) <= sec && b.end(i) > sec + 1) { ok = true; }
            }
            if (!ok) { return false; }
        }
        return true;
    };

    /* ---------------- Paketleme (MKV kare -> MP4 ornek) ---------------- */

    function VideoPack(track, info) {
        this.track = track;
        this.info = info;
        this.dur = track.defaultDurationNs ? track.defaultDurationNs * 90000 / 1e9 : 0;
        this.reset();
    }
    VideoPack.prototype.reset = function () {
        this.waitKey = true;
        this.started = false;
        this.next = 0;
        this.last = -Infinity;
        this.pend = [];
    };
    VideoPack.prototype.push = function (f) {
        if (this.waitKey) {
            if (!f.key) { return; }
            this.waitKey = false;
        }
        var pts = Math.round((f.ms + OFFSET_MS) * 90);
        this.pend.push({ data: f.data, pts: pts, key: f.key });
    };
    /** @returns {{base, samples}|null} */
    VideoPack.prototype.flush = function () {
        if (!this.pend.length) { return null; }
        var p = this.pend;
        this.pend = [];
        if (!this.dur) {
            /* Kare suresi bilinmiyor: sunum zamanlarindan tahmin et */
            var s = p.map(function (x) { return x.pts; }).sort(function (a, b) { return a - b; });
            var d = [];
            for (var k = 1; k < s.length; k++) { if (s[k] > s[k - 1]) { d.push(s[k] - s[k - 1]); } }
            d.sort(function (a, b) { return a - b; });
            this.dur = d.length ? d[d.length >> 1] : 3600;
        }
        var out = [];
        for (var i = 0; i < p.length; i++) {
            var f = p[i];
            /* +2 ms pay: MKV zamanlari milisaniyeye yuvarli, kare suresi kesirli;
               aksi halde gosterim farki yer yer -0,5 ms'e dusuyor */
            var expect = f.pts - REORDER_FRAMES * this.dur - 180;
            if (!this.started) { this.started = true; this.next = Math.max(0, expect); }
            /* Anahtar karede kayma buyurse hizala (degisken kare hizi) */
            if (f.key && Math.abs(this.next - expect) > 2 * this.dur && expect > this.last) { this.next = expect; }
            var dts = Math.round(this.next);
            if (dts <= this.last) { dts = this.last + 1; }
            this.next += this.dur;
            this.last = dts;
            out.push({ data: f.data, dts: dts, pts: f.pts, key: f.key });
        }
        for (var j = 0; j < out.length; j++) {
            var nd = j + 1 < out.length ? out[j + 1].dts : Math.round(this.next);
            out[j].dur = Math.max(1, nd - out[j].dts);
            out[j].cto = out[j].pts - out[j].dts;
        }
        return { base: out[0].dts, samples: out };
    };

    function AudioPack(track, info) {
        this.track = track;
        this.info = info;
        this.rate = info.timescale;
        this.reset();
    }
    AudioPack.prototype.reset = function () {
        this.next = null;
        this.lastMs = null;
        this.pend = [];
        this.minMs = 0;
    };
    AudioPack.prototype.push = function (f) {
        if (f.ms < this.minMs) { return; }               /* anahtar kareden onceki ses */
        var expected = Math.round((f.ms + OFFSET_MS) * this.rate / 1000);
        /* Ayni bloktaki (paketlenmis) karelerin zamani tekrarlanir: yalnizca
           yeni blokta kaymaya bak. */
        if (this.next === null || (f.ms !== this.lastMs && Math.abs(this.next - expected) > this.rate * 0.08)) {
            this.next = expected;
        }
        this.lastMs = f.ms;
        var parts = App.Fmp4.splitAudio(this.track.codec, f.data);
        for (var i = 0; i < parts.length; i++) {
            this.pend.push({ data: parts[i].data, dts: this.next, dur: parts[i].samples, cto: 0, key: true });
            this.next += parts[i].samples;
        }
    };
    AudioPack.prototype.flush = function () {
        if (!this.pend.length) { return null; }
        var p = this.pend;
        this.pend = [];
        return { base: p[0].dts, samples: p };
    };

    /* ---------------- Akis ---------------- */

    /**
     * Verilen konumdan indirmeye basla (sarma / ilk acilis / ses degisimi).
     * @returns {Promise} ilk goruntu parcasi eklenince cozulur
     */
    MsePlayer.prototype._startStream = function (ms) {
        var self = this;
        var session = this._session;
        if (this.stream) { this.stream.dead = true; }
        if (this._xhr) { try { this._xhr.abort(); } catch (e) { } }

        var cue = this.cues[0];
        for (var i = 0; i < this.cues.length; i++) {
            if (this.cues[i].ms <= ms + 50) { cue = this.cues[i]; } else { break; }
        }
        var st = { dead: false, pos: cue.pos, first: true, startMs: cue.ms };
        this.stream = st;
        this.eos = false;

        var vp = new VideoPack(this.video.track, this.video.info);
        var ap = this.audio ? new AudioPack(this.audio.track, this.audio.info) : null;
        if (ap) { ap.minMs = cue.ms - 100; }
        st.vp = vp;
        st.ap = ap;

        var tracks = {};
        tracks[this.video.track.number] = true;
        if (this.audio) { tracks[this.audio.track.number] = true; }
        var strip = {};
        var allSubs = this.subTracks;
        for (var s = 0; s < allSubs.length; s++) { tracks[allSubs[s].number] = true; }
        for (var t = 0; t < this.tracks.length; t++) {
            if (this.tracks[t].strip) { strip[this.tracks[t].number] = this.tracks[t].strip; }
        }

        var firstResolve;
        var firstPromise = new Promise(function (r) { firstResolve = r; });

        var dm = new App.Mkv.Demuxer({
            tracks: tracks,
            strip: strip,
            timescale: this.info.timescale,
            onFrame: function (f) {
                if (f.track === self.video.track.number) { vp.push(f); }
                else if (ap && f.track === self.audio.track.number) { self._audioFrame(ap, f); }
                else if (self.subs[f.track]) { self._subFrame(f); }
            },
            onEnd: function () { st.ended = true; }
        });
        dm.reset(cue.pos);
        st.dm = dm;

        /* Sarmadan sonra eski tamponu temizle ve baslangic parcalarini yeniden ver */
        this._flushBuffers();

        function emit() {
            var v = vp.flush();
            if (v) {
                self._enqueue('video', App.Fmp4.mediaSegment(1, self.sb.video.seq++, v.base, v.samples), function () {
                    if (firstResolve) { var r = firstResolve; firstResolve = null; r(); }
                });
            }
            if (ap && self.sb.audio && self.sb.audio.inited) {
                var a = ap.flush();
                if (a) { self._enqueue('audio', App.Fmp4.mediaSegment(1, self.sb.audio.seq++, a.base, a.samples)); }
            }
        }

        function loop() {
            if (st.dead || session !== self._session) { return; }
            if (st.ended || (self.size && st.pos >= self.size)) {
                emit();
                self._finish(st);
                return;
            }
            /* Yeterince ileride tampon var: bekle */
            if (!st.first && (self._aheadMs() > self.aheadMs || self._queuedBytes() > 6 * 1024 * 1024)) {
                setTimeout(loop, 700);
                return;
            }
            var size = st.first ? CHUNK_FIRST : CHUNK;
            var to = st.pos + size - 1;
            if (self.size) { to = Math.min(to, self.size - 1); }
            var from = st.pos;
            self._range(from, to, session).then(function (b) {
                if (st.dead || session !== self._session) { return; }
                dm.push(b, from);
                st.pos = Math.max(from + b.length, dm.wantPos());
                emit();
                st.first = false;
                self._evict();
                loop();
            }, function (err) {
                if (st.dead || session !== self._session || (err && err.aborted)) { return; }
                log.error('indirme basarisiz', err && (err.status || err.message));
                self._fatal('PLAYER_ERROR_NETWORK', 'Ag hatasi nedeniyle yayin kesildi.');
            });
        }
        loop();
        return firstPromise;
    };

    MsePlayer.prototype._audioFrame = function (ap, f) {
        var s = this.sb.audio;
        if (!s) { return; }
        if (!s.inited) {
            /* Dolby ayarlari ilk karenin basligindan okunur */
            if (!ap.info.entry) {
                var full = App.Fmp4.codecFor(ap.track, f.data);
                if (!full || !full.entry) { return; }
                ap.info = full;
                ap.rate = full.timescale;
                this.audio.info = full;
            }
            this._enqueue('audio', App.Fmp4.initSegment(ap.info, 1));
            s.inited = true;
        }
        ap.push(f);
    };

    MsePlayer.prototype._subFrame = function (f) {
        var list = this.subs[f.track];
        var text = '';
        try { text = decodeURIComponent(escape(String.fromCharCode.apply(null, f.data))); }
        catch (e) { text = String.fromCharCode.apply(null, f.data); }
        var tr = null;
        for (var i = 0; i < this.subTracks.length; i++) { if (this.subTracks[i].number === f.track) { tr = this.subTracks[i]; } }
        if (tr && /ASS|SSA/.test(tr.codec)) {
            /* ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text */
            var parts = text.split(',');
            text = parts.slice(8).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n');
        }
        var cue = { s: f.ms, e: f.ms + (f.durMs || 3000), text: text };
        /* Ayni zamanda zaten varsa ekleme (sarmada ayni kume tekrar okunur) */
        for (var j = list.length - 1; j >= 0 && j >= list.length - 50; j--) {
            if (Math.abs(list[j].s - cue.s) < 1) { return; }
        }
        list.push(cue);
        if (list.length > 1 && list[list.length - 2].s > cue.s) { list.sort(function (a, b) { return a.s - b.s; }); }
    };

    /** Eski tamponu sil, baslangic parcalarini yeniden ver */
    MsePlayer.prototype._flushBuffers = function () {
        for (var k in this.sb) {
            if (!this.sb.hasOwnProperty(k)) { continue; }
            var s = this.sb[k];
            s.q = [];
            try { if (s.buf.updating) { s.buf.abort(); } } catch (e) { }
            s.q.push({ remove: true, start: 0, end: Infinity });
            if (k === 'video') { s.q.push({ data: App.Fmp4.initSegment(this.video.info, 1) }); s.inited = true; }
            else if (this.audio && this.audio.info.entry) { s.q.push({ data: App.Fmp4.initSegment(this.audio.info, 1) }); s.inited = true; }
            else { s.inited = false; }
            this._pump(s);
        }
    };

    /** Arkada kalan tamponu sil (bellek) */
    MsePlayer.prototype._evict = function () {
        var t = this.el.currentTime;
        var keep = this.behindMs / 1000;
        if (t < keep + 2) { return; }
        for (var k in this.sb) {
            if (!this.sb.hasOwnProperty(k)) { continue; }
            var s = this.sb[k];
            var b = s.buf.buffered;
            /* 2 sn paydan sonra sil: her parcada kucuk silmeler olmasin */
            if (b.length && b.start(0) < t - keep - 2) {
                s.q.push({ remove: true, start: 0, end: t - keep });
                this._pump(s);
            }
        }
    };

    MsePlayer.prototype._finish = function (st) {
        var self = this;
        if (st.dead || this.eos) { return; }
        /* Kuyruklar bosalinca akisin bittigini bildir */
        if (this._queuedBytes() > 0 || this._updating()) {
            setTimeout(function () { self._finish(st); }, 300);
            return;
        }
        this.eos = true;
        try { if (this.ms && this.ms.readyState === 'open') { this.ms.endOfStream(); } } catch (e) { }
        log.info('dosyanin sonuna gelindi');
    };

    MsePlayer.prototype._updating = function () {
        for (var k in this.sb) { if (this.sb.hasOwnProperty(k) && this.sb[k].buf.updating) { return true; } }
        return false;
    };

    MsePlayer.prototype._fatal = function (code, msg) {
        if (this._dead) { return; }
        this._dead = true;
        if (this.stream) { this.stream.dead = true; }
        this._fire('onError', code, msg);
    };

    /* ---------------- Olaylar ---------------- */

    MsePlayer.prototype._bind = function () {
        if (this._bound) { return; }
        this._bound = true;
        var self = this;
        var v = this.el;
        v.addEventListener('waiting', function () { if (self.prepared) { self._fire('onBufferingStart'); } });
        v.addEventListener('playing', function () { if (self.prepared) { self._fire('onBufferingComplete'); } });
        v.addEventListener('seeked', function () {
            var w = self.seekWaiters;
            self.seekWaiters = [];
            for (var i = 0; i < w.length; i++) { w[i](true); }
        });
        v.addEventListener('ended', function () { if (self.prepared && self.eos) { self._fire('onComplete'); } });
        v.addEventListener('error', function () {
            if (!self.prepared || !v.error) { return; }
            log.error('video hatasi', v.error.code, v.error.message || '');
            self._fatal('PLAYER_ERROR_NOT_SUPPORTED_FILE', 'Bu dosya cozumlenemedi.');
        });
    };

    MsePlayer.prototype._tick = function () {
        var self = this;
        if (this._timer) { clearInterval(this._timer); }
        var n = 0;
        this._timer = setInterval(function () {
            if (!self.prepared) { return; }
            n++;
            var ms = Math.max(0, Math.floor(self.el.currentTime * 1000 - OFFSET_MS));
            if (n % 2 === 0 && !self.el.paused && !self.el.seeking) { self._fire('onTime', ms); }
            self._subtitleTick(ms);
        }, 250);
    };

    MsePlayer.prototype._subtitleTick = function (ms) {
        if (this.subHidden || !this.subTrack) {
            if (this.subShown) { this.subShown = null; this._fire('onSubtitle', '', 0); }
            return;
        }
        var list = this.subs[this.subTrack] || [];
        var cur = null;
        /* Ikili arama: s <= ms olan son ipucu */
        var lo = 0;
        var hi = list.length - 1;
        while (lo <= hi) {
            var mid = (lo + hi) >> 1;
            if (list[mid].s <= ms) { lo = mid + 1; } else { hi = mid - 1; }
        }
        if (hi >= 0 && list[hi].e > ms) { cur = list[hi]; }
        if (cur === this.subShown) { return; }
        this.subShown = cur;
        if (cur) { this._fire('onSubtitle', cur.text, Math.max(200, cur.e - ms)); }
        else { this._fire('onSubtitle', '', 0); }
    };

    /* ---------------- Arayuz (avplay.js / html5.js ile ayni) ---------------- */

    /**
     * @param {string} url
     * @param {object} opts {isLive, displayMode, startMs}
     */
    MsePlayer.prototype.prepare = function (url, opts) {
        var self = this;
        opts = opts || {};
        this._teardown();
        var session = ++this._session;
        this._dead = false;
        this.url = url;
        this.isLive = false;
        this._bind();
        this.setDisplayMethod(opts.displayMode);
        var startMs = Math.max(0, opts.startMs || 0);

        return this._loadHead(session).then(function () {
            if (session !== self._session) { throw new App.AppError(App.ERR.PLAYER, 'yerine yenisi acildi'); }
            return self._openSource(session);
        }).then(function () {
            if (session !== self._session) { throw new App.AppError(App.ERR.PLAYER, 'yerine yenisi acildi'); }
            try { self.el.currentTime = (startMs + OFFSET_MS) / 1000; } catch (e) { }
            return self._startStream(startMs);
        }).then(function () {
            if (session !== self._session) { throw new App.AppError(App.ERR.PLAYER, 'yerine yenisi acildi'); }
            self.prepared = true;
            self._tick();
            log.info('hazir (MSE):', Math.round(self.info.durationMs / 1000) + ' sn');
            self._fire('onReady');
        }, function (err) {
            if (session === self._session) { self._teardown(); }
            var msg = (err && err.message) || (err && err.status ? 'HTTP ' + err.status : 'MSE acilamadi');
            log.warn('MSE hazirlanamadi:', msg);
            throw (err instanceof App.AppError) ? err : new App.AppError(App.ERR.PLAYER, 'MSE: ' + msg);
        });
    };

    MsePlayer.prototype.play = function () {
        document.body.classList.add('player-active');
        this.el.classList.add('is-mse');
        var p = this.el.play();
        if (p && p.catch) { p.catch(function (e) { log.warn('play', e && e.message); }); }
        return true;
    };
    MsePlayer.prototype.pause = function () { this.el.pause(); return true; };
    MsePlayer.prototype.resume = function () { return this.play(); };

    MsePlayer.prototype._teardown = function () {
        this._session++;
        if (this.stream) { this.stream.dead = true; }
        if (this._xhr) { try { this._xhr.abort(); } catch (e) { } }
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        var w = this.seekWaiters;
        this.seekWaiters = [];
        for (var i = 0; i < w.length; i++) { w[i](false); }
        try { this.el.pause(); } catch (e2) { }
        if (this.objUrl) {
            try { this.el.removeAttribute('src'); this.el.load(); } catch (e3) { }
            try { URL.revokeObjectURL(this.objUrl); } catch (e4) { }
        }
        var keepSession = this._session;
        this._reset();
        this._session = keepSession;
    };

    MsePlayer.prototype.stop = function () {
        var hadSub = !!this.subShown;
        this._teardown();
        document.body.classList.remove('player-active');
        this.el.classList.remove('is-mse');
        if (hadSub) { this._fire('onSubtitle', '', 0); }
    };

    /**
     * Mutlak konuma sar. Tamponda varsa aninda, yoksa dizinden ilgili
     * kumeyi bulup oradan indirmeye devam eder.
     * @returns {Promise<boolean>}
     */
    MsePlayer.prototype.seekTo = function (ms) {
        var self = this;
        if (!this.prepared) { return Promise.resolve(false); }
        var dur = this.info.durationMs || 0;
        var target = Math.max(0, Math.min(ms, dur ? dur - 1000 : ms));
        var sec = (target + OFFSET_MS) / 1000;
        this.lastSeekFail = '';

        return new Promise(function (resolve) {
            var done = false;
            function fin(ok) {
                if (done) { return; }
                done = true;
                clearTimeout(guard);
                if (!ok && !self.lastSeekFail) { self.lastSeekFail = 'timeout'; }
                resolve(ok);
            }
            var guard = setTimeout(function () { fin(false); }, SEEK_TIMEOUT_MS);
            self.seekWaiters.push(fin);
            if (!self._inBuffer(sec)) {
                self.eos = false;
                self._startStream(target);
            }
            try { self.el.currentTime = sec; } catch (e) { fin(false); }
        });
    };

    MsePlayer.prototype.jump = function (deltaMs) {
        return this.seekTo(this.getCurrentTime() + deltaMs);
    };

    MsePlayer.prototype.getState = function () {
        if (!this.prepared) { return 'NONE'; }
        return this.el.paused ? 'PAUSED' : 'PLAYING';
    };

    MsePlayer.prototype.getCurrentTime = function () {
        return this.prepared ? Math.max(0, Math.floor(this.el.currentTime * 1000 - OFFSET_MS)) : 0;
    };

    MsePlayer.prototype.getDuration = function () {
        return this.info ? Math.floor(this.info.durationMs) : 0;
    };

    MsePlayer.prototype.setDisplayMethod = function (mode) {
        this.el.style.objectFit = (mode === 'PLAYER_DISPLAY_MODE_FULL_SCREEN') ? 'fill' : 'contain';
    };
    MsePlayer.prototype.setDisplayRect = function () { /* CSS ile tam ekran */ };
    MsePlayer.prototype.setFullscreen = function () { };

    /** @returns {Array<{index, type, language, label}>} index = MKV parca numarasi */
    MsePlayer.prototype.getTracks = function () {
        var out = [];
        for (var i = 0; i < this.tracks.length; i++) {
            var t = this.tracks[i];
            var type = t.type === 1 ? 'VIDEO' : (t.type === 2 ? 'AUDIO' : (t.type === 17 ? 'TEXT' : ''));
            if (!type) { continue; }
            if (type === 'AUDIO' && !audioOk(t)) { continue; }
            if (type === 'TEXT' && !SUB_CODECS[t.codec]) { continue; }
            if (type === 'VIDEO' && (!this.video || t.number !== this.video.track.number)) { continue; }
            out.push({
                index: t.number,
                type: type,
                language: (t.lang && t.lang !== 'und') ? t.lang : '',
                label: t.name || (t.codec || '').replace(/^[AVS]_/, '')
            });
        }
        return out;
    };

    MsePlayer.prototype.selectTrack = function (type, index) {
        var i;
        if (type === 'TEXT') {
            for (i = 0; i < this.subTracks.length; i++) {
                if (this.subTracks[i].number === index) {
                    this.subTrack = index;
                    this.subShown = undefined;           /* bir sonraki tikte yeniden ciz */
                    return true;
                }
            }
            return false;
        }
        if (type !== 'AUDIO' || !this.prepared) { return false; }
        if (this.audio && this.audio.track.number === index) { return true; }
        var t = null;
        for (i = 0; i < this.tracks.length; i++) { if (this.tracks[i].number === index && audioOk(this.tracks[i])) { t = this.tracks[i]; } }
        if (!t) { return false; }
        var info = App.Fmp4.codecFor(t);
        var s = this.sb.audio;
        if (!s) { return false; }
        if (info.mime !== s.mime) {
            /* Farkli kodek (ornek: AC-3 -> E-AC-3) */
            if (!s.buf.changeType) { return false; }
            try { s.buf.changeType(info.mime); s.mime = info.mime; } catch (e) { return false; }
        }
        log.info('ses parcasi degisiyor:', t.lang || index);
        this.audio = { track: t, info: info };
        this.audioTrack = index;
        /* Ayni noktadan yeniden indir (yeni ses parcasiyla) */
        var now = this.getCurrentTime();
        this.eos = false;
        this._startStream(now);
        try { this.el.currentTime = (now + OFFSET_MS) / 1000; } catch (e2) { }
        return true;
    };

    MsePlayer.prototype.setSubtitleHidden = function (hidden) {
        this.subHidden = !!hidden;
        if (!hidden && !this.subTrack && this.subTracks.length) { this.subTrack = this.subTracks[0].number; }
        this.subShown = undefined;
    };

    MsePlayer.prototype.getBandwidth = function () { return this.bandwidth; };
    MsePlayer.prototype.dispose = function () { this.stop(); };

    MsePlayer.supportsInfo = function (track) { return !!App.Fmp4.codecFor(track); };

    /* testler icin */
    MsePlayer._VideoPack = VideoPack;
    MsePlayer._AudioPack = AudioPack;

    App.MsePlayer = MsePlayer;
})(window.App = window.App || {});
