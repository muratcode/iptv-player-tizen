/* ============================================================
   services/epg.js
   Elektronik Program Rehberi (EPG).

   IKI KAYNAK:
   1) Xtream get_short_epg  -> kanal bazinda, ISTENDIGINDE cekilir.
      Hizlidir (birkac KB), 2 dakika onbelleklenir. Canli TV
      ekraninda secili kanal degistikce bu kullanilir.

   2) XMLTV (xmltv.php veya M3U'daki x-tvg-url) -> TUM kanallarin
      rehberi tek dosyada. 10-80 MB olabilir. Yalnizca kullanici
      "EPG Yenile" derse veya M3U modunda indirilir.

   XMLTV BELLEK STRATEJISI (TV'de RAM sinirlidir):
     - DOMParser KULLANILMAZ. 50 MB XML icin DOM agaci ~500 MB RAM
       ister ve TV uygulamayi oldurur. Bunun yerine regex ile
       akis halinde (streaming) cozumleme yapilir.
     - Yalnizca "simdi - 2 saat" ile "simdi + 36 saat" araligindaki
       programlar saklanir.
     - Kanal basina en fazla MAX_PER_CHANNEL kayit tutulur.
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('EPG');
    var U = App.Utils;

    var MAX_PER_CHANNEL = 40;
    var WINDOW_BACK_MS = 2 * 60 * 60 * 1000;
    var WINDOW_FWD_MS = 36 * 60 * 60 * 1000;
    var PARSE_CHUNK = 400;          /* her tikta islenecek <programme> sayisi */

    /* XMLTV indeksi: { channelId: [ {s, e, t, d} ] }  (bellekte) */
    var index = null;
    var indexMeta = { loadedAt: 0, channels: 0, programmes: 0, source: '' };

    var XML_ENTITIES = {
        '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'"
    };

    function decodeXml(s) {
        if (!s) { return ''; }
        return s
            .replace(/&(amp|lt|gt|quot|apos|#39);/g, function (m) { return XML_ENTITIES[m] || m; })
            .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
            .replace(/&#x([0-9a-fA-F]+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
            .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
            .trim();
    }

    function firstTag(block, tag) {
        var re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'i');
        var m = re.exec(block);
        return m ? decodeXml(m[1]) : '';
    }

    /* ---------- Ortak EPG nesnesi ----------
       { start:Date, stop:Date, title:string, desc:string } */

    function toPublic(rec) {
        if (!rec) { return null; }
        return {
            start: new Date(rec.s),
            stop: rec.e ? new Date(rec.e) : null,
            title: rec.t,
            desc: rec.d || ''
        };
    }

    /** Bir program listesinde "su an" ve "sonraki" programi bulur */
    function pickNowNext(list, atMs) {
        var now = atMs || Date.now();
        var cur = null, next = null;
        for (var i = 0; i < list.length; i++) {
            var p = list[i];
            var s = p.start ? p.start.getTime() : 0;
            var e = p.stop ? p.stop.getTime() : (s + 3600000);
            if (s <= now && now < e) { cur = p; if (i + 1 < list.length) { next = list[i + 1]; } break; }
            if (s > now) { next = p; break; }
        }
        return { now: cur, next: next, list: list };
    }

    var E = {
        /* ==================== XTREAM (kanal bazinda) ==================== */

        /**
         * Secili kanalin simdiki + sonraki programi.
         * @param {object} channel  {id, epgChannelId, ...}
         * @returns {Promise<{now, next, list}>}
         */
        forChannel: function (channel) {
            if (!channel) { return Promise.resolve({ now: null, next: null, list: [] }); }

            /* 1) XMLTV indeksi yuklendiyse oradan (ag istegi yok - aninda) */
            if (index && channel.epgChannelId && index[channel.epgChannelId]) {
                var recs = index[channel.epgChannelId];
                var list = [];
                for (var i = 0; i < recs.length; i++) { list.push(toPublic(recs[i])); }
                return Promise.resolve(pickNowNext(list));
            }

            /* 2) Xtream ise get_short_epg */
            if (App.Content.sourceType() === 'xtream' && channel.type === 'live') {
                var key = App.Profile.key('epg.short.' + channel.id);
                return App.Cache.wrap(key, App.Cache.TTL.SHORT, function () {
                    return App.Xtream.getShortEpg(channel.id, 8);
                }, { persist: false })
                    .then(function (list2) { return pickNowNext(list2 || []); })
                    .catch(function (err) {
                        /* EPG bulunamamasi KRITIK DEGILDIR - sessizce bos don */
                        log.debug('short_epg alinamadi', channel.id, App.AppError.wrap(err).code);
                        return { now: null, next: null, list: [] };
                    });
            }

            return Promise.resolve({ now: null, next: null, list: [] });
        },

        /* ==================== XMLTV ==================== */

        hasIndex: function () { return !!index; },
        meta: function () { return Object.assign({}, indexMeta); },

        /**
         * XMLTV dosyasini indirip bellek ici indeks olusturur.
         * @param {string} url
         * @param {object} [opts] {channelIds: [..] sadece bunlari sakla,
         *                         onStatus: fn(text)}
         */
        loadXmltv: function (url, opts) {
            opts = opts || {};
            var onStatus = opts.onStatus || function () { };

            if (!url) {
                return Promise.reject(new App.AppError(App.ERR.NOT_FOUND, 'EPG adresi tanimli degil'));
            }

            /* Ilgilenilen kanal kimlikleri (yoksa hepsi) */
            var wanted = null;
            if (opts.channelIds && opts.channelIds.length) {
                wanted = {};
                for (var i = 0; i < opts.channelIds.length; i++) {
                    if (opts.channelIds[i]) { wanted[String(opts.channelIds[i])] = true; }
                }
            }

            onStatus('EPG dosyasi indiriliyor...');
            var t0 = Date.now();

            return App.Http.getText(url, {
                timeout: 120000,
                retries: 0,
                onProgress: function (loaded, total) {
                    onStatus(total
                        ? 'EPG indiriliyor: %' + Math.round(loaded * 100 / total)
                        : 'EPG indiriliyor: ' + Math.round(loaded / 1048576) + ' MB');
                }
            }).then(function (xml) {
                onStatus('EPG cozumleniyor...');
                return E.parseXmltv(xml, wanted, onStatus);
            }).then(function (result) {
                index = result.index;
                indexMeta = {
                    loadedAt: Date.now(),
                    channels: result.channels,
                    programmes: result.programmes,
                    source: url,
                    ms: Date.now() - t0
                };
                log.info('XMLTV yuklendi:', indexMeta.channels, 'kanal /',
                         indexMeta.programmes, 'program /', indexMeta.ms + 'ms');
                App.Bus.emit('epg:loaded', indexMeta);
                return indexMeta;
            });
        },

        /**
         * XMLTV metnini parcalar halinde cozumler (UI kilitlenmez).
         * @returns {Promise<{index, channels, programmes}>}
         */
        parseXmltv: function (xml, wanted, onStatus) {
            return new Promise(function (resolve, reject) {
                if (!xml || xml.indexOf('<tv') === -1) {
                    return reject(new App.AppError(App.ERR.PARSE, 'gecerli bir XMLTV dosyasi degil'));
                }

                var idx = {};
                var minMs = Date.now() - WINDOW_BACK_MS;
                var maxMs = Date.now() + WINDOW_FWD_MS;
                var re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
                var total = 0, kept = 0;
                var totalLen = xml.length;

                function tick() {
                    var n = 0, m;
                    try {
                        while (n < PARSE_CHUNK && (m = re.exec(xml)) !== null) {
                            n++; total++;

                            var attrs = m[1];
                            var chMatch = /channel\s*=\s*"([^"]*)"/i.exec(attrs);
                            if (!chMatch) { continue; }
                            var chId = decodeXml(chMatch[1]);
                            if (wanted && !wanted[chId]) { continue; }

                            var startM = /start\s*=\s*"([^"]*)"/i.exec(attrs);
                            if (!startM) { continue; }
                            var sd = U.parseXmltvDate(startM[1]);
                            if (!sd) { continue; }
                            var sMs = sd.getTime();
                            if (sMs < minMs || sMs > maxMs) { continue; }

                            var stopM = /stop\s*=\s*"([^"]*)"/i.exec(attrs);
                            var ed = stopM ? U.parseXmltvDate(stopM[1]) : null;

                            var body = m[2];
                            var title = firstTag(body, 'title');
                            if (!title) { continue; }

                            if (!idx[chId]) { idx[chId] = []; }
                            if (idx[chId].length >= MAX_PER_CHANNEL) { continue; }

                            idx[chId].push({
                                s: sMs,
                                e: ed ? ed.getTime() : 0,
                                t: title,
                                d: firstTag(body, 'desc')
                            });
                            kept++;
                        }
                    } catch (e) {
                        return reject(new App.AppError(App.ERR.PARSE, 'XMLTV: ' + (e && e.message)));
                    }

                    if (m === null || re.lastIndex === 0) {
                        /* Bitti - her kanalin listesini zamana gore sirala */
                        var chCount = 0;
                        for (var k in idx) {
                            if (Object.prototype.hasOwnProperty.call(idx, k)) {
                                idx[k].sort(function (a, b) { return a.s - b.s; });
                                chCount++;
                            }
                        }
                        return resolve({ index: idx, channels: chCount, programmes: kept });
                    }

                    if (onStatus && total % 4000 === 0) {
                        onStatus('EPG cozumleniyor: %' + Math.round(re.lastIndex * 100 / totalLen));
                    }
                    setTimeout(tick, 0);
                }
                tick();
            });
        },

        /** Kanal kimligine gore bellek ici indexten simdi/sonraki */
        fromIndex: function (epgChannelId) {
            if (!index || !epgChannelId || !index[epgChannelId]) { return null; }
            var recs = index[epgChannelId];
            var list = [];
            for (var i = 0; i < recs.length; i++) { list.push(toPublic(recs[i])); }
            return pickNowNext(list);
        },

        /** Programin ne kadari gecti (0..1) - ilerleme cubugu icin */
        progressOf: function (prog) {
            if (!prog || !prog.start || !prog.stop) { return 0; }
            var s = prog.start.getTime(), e = prog.stop.getTime(), n = Date.now();
            if (e <= s) { return 0; }
            return U.clamp((n - s) / (e - s), 0, 1);
        },

        /** "20:00 - 21:30" */
        timeRange: function (prog) {
            if (!prog) { return ''; }
            return U.hhmm(prog.start) + (prog.stop ? ' - ' + U.hhmm(prog.stop) : '');
        },

        clear: function () {
            index = null;
            indexMeta = { loadedAt: 0, channels: 0, programmes: 0, source: '' };
            App.Cache.invalidate(App.Profile.key('epg.'));
            log.info('EPG temizlendi');
        }
    };

    App.EPG = E;
})(window.App = window.App || {});
