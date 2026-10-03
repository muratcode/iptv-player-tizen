/* ============================================================
   services/m3u.js
   M3U / M3U8 playlist cozumleyici.

   DESTEKLENEN SATIRLAR:
     #EXTM3U [x-tvg-url="..."]              -> playlist basligi + EPG adresi
     #EXTINF:-1 tvg-id=".." tvg-name=".."
              tvg-logo=".." group-title="..",KANAL ADI
     #EXTGRP:Grup Adi                        -> yapiskan grup tanimi
     #EXTVLCOPT:http-user-agent=...          -> yok sayilir
     #KODIPROP:...                           -> yok sayilir
     http://... veya https://...             -> stream adresi

   GRUP SIRASI
   -----------
   Gruplar ALFABETIK SIRALANMAZ; playlist icinde ilk gorulme sirasi
   korunur. Saglayicilar listeyi bilerek siralar (ornegin Turkce
   kanallar en ustte olur) ve alfabetik siralama bu duzeni bozar.

   DIZI TESPITI
   ------------
   M3U formatinda sezon/bolum yapisi YOKTUR; bolumler duz VOD satiri
   olarak gelir:
       #EXTINF:-1 group-title="DIZILER",Dizi Adi S01 E05
   Bu cozumleyici asagidaki kaliplari taniyip bolumleri otomatik olarak
   dizilere gruplar:
       S01E05 / S01 E05 / S1.E5 / 1x05 / Sezon 1 Bolum 5 / Season 1 Episode 5
   Boylece M3U kaynaklarinda da "Diziler" bolumu calisir ve bolumler
   Filmler icinde tek tek gorunmez.
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('M3U');
    var U = App.Utils;

    var CHUNK = 2000;

    /* --------- Dizi/bolum kaliplari (siralama onemli: ozelden genele) --------- */
    var EPISODE_PATTERNS = [
        /* "Sezon 1 Bolum 5", "Sezon 1. Bolum 5" */
        { re: /\bsezon\s*(\d{1,2})\D{0,12}?b[öo]l[üu]m\s*(\d{1,3})\b/i, s: 1, e: 2 },
        /* "Season 1 Episode 5" */
        { re: /\bseason\s*(\d{1,2})\D{0,12}?episode\s*(\d{1,3})\b/i, s: 1, e: 2 },
        /* "S01E05", "S01 E05", "S01.E05", "S1 - E5" */
        { re: /\bs\s*(\d{1,2})\s*[\s._x-]*\s*e\s*(\d{1,3})\b/i, s: 1, e: 2 },
        /* "1x05" */
        { re: /\b(\d{1,2})\s*x\s*(\d{1,3})\b/i, s: 1, e: 2 },
        /* Yalnizca "Bolum 5" -> sezon 1 varsayilir */
        { re: /\bb[öo]l[üu]m\s*(\d{1,3})\b/i, s: 0, e: 1 }
    ];

    /**
     * Bir baslikta dizi/bolum bilgisi var mi?
     * @returns {{series:string, season:number, episode:number}|null}
     */
    function detectEpisode(name) {
        if (!name) { return null; }
        for (var i = 0; i < EPISODE_PATTERNS.length; i++) {
            var p = EPISODE_PATTERNS[i];
            var m = p.re.exec(name);
            if (!m) { continue; }

            var season = p.s ? U.toInt(m[p.s], 1) : 1;
            var episode = U.toInt(m[p.e], 0);
            if (!episode) { continue; }

            /* Dizi adi = eslesmenin SOLUNDA kalan kisim */
            var seriesName = name.substr(0, m.index)
                .replace(/[\s._:|\-–—]+$/, '')
                .trim();

            /* Ad bos kaldiysa (ornek: baslik sadece "S01E05") kalip guvenilmezdir */
            if (seriesName.length < 2) { continue; }

            /* Eslesmenin SAGINDA kalan kisim varsa bolum basligidir:
               "Dizi Adi S01 E05 - Kayip Sehir"  ->  "Kayip Sehir" */
            var title = name.substr(m.index + m[0].length)
                .replace(/^[\s._:|\-–—]+/, '')
                .trim();

            return { series: seriesName, season: season, episode: episode, title: title };
        }
        return null;
    }

    /** #EXTINF satirindaki attribute'lari cozer */
    function parseAttrs(line) {
        var attrs = {};
        var re = /([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g;
        var m;
        while ((m = re.exec(line)) !== null) {
            attrs[m[1].toLowerCase()] = m[2];
        }
        return attrs;
    }

    /** #EXTINF:-1 ...,Kanal Adi  ->  "Kanal Adi" */
    function parseTitle(line) {
        var idx = line.lastIndexOf(',');
        if (idx === -1) { return ''; }
        /* Virgul bir attribute degerinin icinde olabilir; son tirnaktan
           sonraki ilk virgulu bulmak daha guvenli */
        var lastQuote = line.lastIndexOf('"');
        if (lastQuote > idx) { return ''; }
        var afterQuote = line.indexOf(',', lastQuote === -1 ? 0 : lastQuote);
        var use = afterQuote !== -1 ? afterQuote : idx;
        return line.substr(use + 1).trim();
    }

    /**
     * Bolum ogelerini dizilere gruplar.
     * @param {Array} items tum ogeler (yerinde degistirilir)
     * @returns {Array} dizi nesneleri
     */
    function buildSeries(items) {
        var map = {};       /* seriesKey -> series */
        var order = [];

        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (it.type !== 'episode') { continue; }

            var sk = 'm3useries:' + U.hash(U.normalize(it.seriesName) + '|' + it.categoryId);
            var s = map[sk];
            if (!s) {
                s = map[sk] = {
                    key: sk,
                    type: 'series',
                    id: sk,
                    name: it.seriesName,
                    logo: it.logo || '',
                    cover: it.logo || '',
                    categoryId: it.categoryId,
                    categoryName: it.categoryName,
                    plot: '',
                    seasonMap: {},
                    seasons: [],
                    episodeCount: 0
                };
                order.push(s);
            }
            if (!s.logo && it.logo) { s.logo = s.cover = it.logo; }

            var sn = it.season;
            var season = s.seasonMap[sn];
            if (!season) {
                season = s.seasonMap[sn] = {
                    number: sn,
                    name: 'Sezon ' + sn,
                    cover: s.logo,
                    overview: '',
                    episodes: []
                };
                s.seasons.push(season);
            }
            it.seriesId = sk;
            season.episodes.push(it);
            s.episodeCount++;
        }

        /* Sezonlari ve bolumleri numaraya gore sirala */
        for (var j = 0; j < order.length; j++) {
            var ser = order[j];
            ser.seasons.sort(function (a, b) { return a.number - b.number; });
            for (var k = 0; k < ser.seasons.length; k++) {
                ser.seasons[k].episodes.sort(function (a, b) { return a.episodeNum - b.episodeNum; });
            }
            delete ser.seasonMap;
        }

        return order;
    }


    /* ============================================================
       KOMPAKT ONBELLEK KODLAMASI

       PROBLEM: Cozumlenmis playlist nesnesi oldugu gibi JSON'a
       cevrilip localStorage'a yazilinca 10.000 kanallik bir listede
       5-8 MB tutuyor ve TV'nin ~5 MB'lik kotasini asiyordu. Yazma
       basarisiz olunca onbellek yalnizca bellekte kaliyor ve
       uygulama HER ACILISTA playlisti yeniden indirip cozumluyordu.

       COZUM: Anahtar adlari tekrar etmesin diye her oge bir DIZIYE
       cevrilir, kategori adi tekrar tekrar yazilmasin diye grup
       INDEKSI tutulur. Bu, boyutu yaklasik %60-70 kucultur ve
       tipik listeler kotaya rahatca sigar. Diziler kayittan
       okunurken yeniden gruplanir (birkac milisaniye surer).
       ============================================================ */

    var T_LIVE = 0, T_MOVIE = 1, T_EPISODE = 2;

    /**
     * Bir dizideki tum metinlerin ORTAK ON EKINI bulur.
     *
     * Neden: Bir playlistteki adreslerin neredeyse tamami ayni sunucudan
     * gelir; ornegin 20.000 kanalin hepsi
     *   http://sunucu:8080/live/kullanici/sifre/
     * ile baslar. Bu 45 karakteri her satirda tekrar saklamak yerine BIR KEZ
     * saklayip yalnizca degisen kuyrugu tutmak, kaydin boyutunu ciddi olcude
     * kucultur (tipik olarak bir kat daha).
     */
    function commonPrefix(list) {
        if (!list.length) { return ''; }
        var p = list[0];
        for (var i = 1; i < list.length && p.length; i++) {
            var s = list[i];
            var n = Math.min(p.length, s.length);
            var k = 0;
            while (k < n && p.charCodeAt(k) === s.charCodeAt(k)) { k++; }
            p = p.substr(0, k);
        }
        return p;
    }

    /** Cozumlenmis veriyi depolamaya uygun kompakt bicime cevirir */
    function pack(d) {
        var gIndex = {};
        var groups = [];
        var i;

        for (i = 0; i < d.groups.length; i++) {
            gIndex[d.groups[i].id] = i;
            groups.push(d.groups[i].name);
        }

        /* Adres ve logo icin ortak on ekleri bir kez sakla */
        var urls = [], logos = [];
        for (i = 0; i < d.items.length; i++) {
            urls.push(d.items[i].url);
            if (d.items[i].logo) { logos.push(d.items[i].logo); }
        }
        var up = commonPrefix(urls);
        var lp = commonPrefix(logos);
        /* Cok kisa on ek kazandirmaz, riske girme */
        if (up.length < 12) { up = ''; }
        if (lp.length < 12) { lp = ''; }

        var items = [];
        for (i = 0; i < d.items.length; i++) {
            var it = d.items[i];
            var t = it.type === 'live' ? T_LIVE : (it.type === 'movie' ? T_MOVIE : T_EPISODE);
            items.push([
                t,
                it.name,
                it.logo ? it.logo.substr(lp.length) : '',
                it.url.substr(up.length),
                gIndex[it.categoryId],
                it.epgChannelId || '',
                it.containerExtension || '',
                it.seriesName || '',
                it.season || 0,
                it.episodeNum || 0
            ]);
        }

        return { v: 2, e: d.epgUrl || '', g: groups, i: items, s: d.stats, up: up, lp: lp };
    }

    /** pack() ciktisini tam veri yapisina geri cevirir */
    function unpack(p) {
        if (!p || !p.i || (p.v !== 1 && p.v !== 2)) { return null; }
        var up = p.up || '';     /* v1 kayitlarinda on ek yoktur */
        var lp = p.lp || '';

        var groups = [];
        var i;
        for (i = 0; i < p.g.length; i++) {
            groups.push({ id: 'g' + U.hash(p.g[i]), name: p.g[i], count: 0 });
        }

        var items = [];
        for (i = 0; i < p.i.length; i++) {
            var a = p.i[i];
            var grp = groups[a[4]] || groups[0] || { id: 'gx', name: 'Diger' };
            grp.count++;

            var item = {
                key: 'm3u:m3u' + i,
                type: a[0] === T_LIVE ? 'live' : (a[0] === T_MOVIE ? 'movie' : 'episode'),
                id: 'm3u' + i,
                name: a[1],
                fullName: a[1],
                logo: a[2] ? (lp + a[2]) : '',
                url: up + a[3],
                num: i + 1,
                categoryId: grp.id,
                categoryName: grp.name,
                epgChannelId: a[5],
                tvgShift: '',
                containerExtension: a[6],
                radio: false
            };
            if (a[0] === T_EPISODE) {
                item.seriesName = a[7];
                item.season = a[8];
                item.episodeNum = a[9];
            }
            items.push(item);
        }

        return {
            items: items,
            series: buildSeries(items),
            groups: groups,
            epgUrl: p.e || '',
            stats: p.s || { items: items.length, groups: groups.length }
        };
    }

    var M = {
        detectEpisode: detectEpisode,
        pack: pack,
        unpack: unpack,

        /**
         * @param {string} text  M3U dosya icerigi
         * @param {function(number,number)} [onProgress] (islenen, toplam)
         * @returns {Promise<{items, movies, series, groups, epgUrl, stats}>}
         */
        parse: function (text, onProgress) {
            if (!text || typeof text !== 'string') {
                return Promise.reject(new App.AppError(App.ERR.PARSE, 'bos icerik'));
            }

            var head = text.substr(0, 400).toUpperCase();
            if (head.indexOf('#EXTM3U') === -1 && head.indexOf('#EXTINF') === -1) {
                /* Bazi saglayicilar basliksiz duz URL listesi dondurur - onu da kabul et */
                if (!/^https?:\/\//im.test(text)) {
                    return Promise.reject(new App.AppError(App.ERR.PARSE, '#EXTM3U basligi yok'));
                }
            }

            var lines = text.split(/\r\n|\n|\r/);
            log.info('cozumleniyor:', lines.length, 'satir');

            var items = [];
            var groupMap = {};
            var groupOrder = [];        /* ILK GORULME sirasini korur */
            var epgUrl = '';
            var pending = null;
            /* #EXTGRP "yapiskandir": bir kez tanimlaninca yenisi gelene kadar
               sonraki tum kayitlar icin gecerlidir (VLC/Kodi davranisi).
               Ayrica #EXTINF'ten ONCE de SONRA da yazilabilir. */
            var stickyGroup = '';
            var seq = 0;
            var skipped = 0;
            var episodeCount = 0;
            var t0 = Date.now();

            function pushItem(url) {
                var name = (pending && pending.name) || '';
                var attrs = (pending && pending.attrs) || {};
                /* Oncelik: satirin kendi group-title'i > #EXTGRP > "Diger" */
                var group = (attrs['group-title'] || '').trim() || stickyGroup || 'Diger';

                if (!name) { name = attrs['tvg-name'] || 'Kanal ' + (seq + 1); }

                var id = 'm3u' + (seq++);
                var lower = url.toLowerCase();

                /* Tur tespiti:
                   - /series/ yolu veya SxxEyy kalibi  -> bolum (episode)
                   - video dosya uzantisi / /movie/    -> film
                   - digerleri                         -> canli yayin */
                var looksVod = /\.(mp4|mkv|avi|mov|m4v|flv|wmv)(\?|$)/.test(lower) ||
                               /\/movie\//.test(lower) || /\/series\//.test(lower);
                var ep = looksVod ? detectEpisode(name) : null;

                var type;
                if (ep) { type = 'episode'; episodeCount++; }
                else if (looksVod) { type = 'movie'; }
                else { type = 'live'; }

                if (!groupMap[group]) {
                    groupMap[group] = { id: 'g' + U.hash(group), name: group, count: 0 };
                    groupOrder.push(groupMap[group]);
                }
                groupMap[group].count++;

                var extMatch = /\.([a-z0-9]{2,4})(?:\?|$)/i.exec(lower);

                var item = {
                    key: 'm3u:' + id,
                    type: type,
                    id: id,
                    name: ep ? buildEpisodeTitle(ep) : name,
                    fullName: name,
                    logo: attrs['tvg-logo'] || attrs['logo'] || '',
                    url: url,
                    num: seq,
                    categoryId: groupMap[group].id,
                    categoryName: group,
                    epgChannelId: attrs['tvg-id'] || attrs['tvg-name'] || '',
                    tvgShift: attrs['tvg-shift'] || '',
                    containerExtension: extMatch ? extMatch[1] : '',
                    radio: String(attrs['radio'] || '').toLowerCase() === 'true'
                };

                if (ep) {
                    item.seriesName = ep.series;
                    item.season = ep.season;
                    item.episodeNum = ep.episode;
                }

                items.push(item);
                pending = null;
            }

            /* Bolum adi: playlistte bir baslik varsa onu kullan, yoksa "Bolum N".
               (Dizi adi zaten ust ekranda gosterildigi icin tekrar edilmez.) */
            function buildEpisodeTitle(ep) {
                return ep.title || ('Bolum ' + ep.episode);
            }

            function handleLine(rawLine) {
                var line = rawLine.trim();
                if (!line) { return; }

                if (line.charAt(0) === '#') {
                    var upper = line.toUpperCase();

                    if (upper.indexOf('#EXTM3U') === 0) {
                        var a = parseAttrs(line);
                        epgUrl = a['x-tvg-url'] || a['url-tvg'] || a['tvg-url'] || '';
                        return;
                    }
                    if (upper.indexOf('#EXTINF') === 0) {
                        pending = { attrs: parseAttrs(line), name: parseTitle(line) };
                        return;
                    }
                    if (upper.indexOf('#EXTGRP') === 0) {
                        stickyGroup = line.substr(line.indexOf(':') + 1).trim();
                        return;
                    }
                    /* #EXTVLCOPT, #KODIPROP, #PLAYLIST, yorumlar -> yok say */
                    return;
                }

                /* URL satiri */
                if (/^(https?|rtmp|rtsp|udp|rtp):\/\//i.test(line)) {
                    pushItem(line);
                } else {
                    skipped++;
                }
            }

            return U.chunked(lines, CHUNK, handleLine, function (done, total) {
                if (onProgress) { onProgress(done, total); }
            }).then(function () {
                /* Bolumleri dizilere grupla */
                var series = buildSeries(items);

                var stats = {
                    lines: lines.length,
                    items: items.length,
                    groups: groupOrder.length,
                    episodes: episodeCount,
                    series: series.length,
                    skipped: skipped,
                    ms: Date.now() - t0
                };
                log.info('cozumlendi:', stats.items, 'oge /', stats.groups, 'grup /',
                         stats.series, 'dizi /', stats.episodes, 'bolum /', stats.ms + 'ms');

                if (!items.length) {
                    throw new App.AppError(App.ERR.EMPTY, 'playlist icinde kanal bulunamadi');
                }

                return {
                    items: items,
                    series: series,
                    /* Gruplar ALFABETIK DEGIL, playlistteki sirayla */
                    groups: groupOrder,
                    epgUrl: epgUrl,
                    stats: stats
                };
            });
        },

        /**
         * URL'den indirip cozumler.
         * @param {string} url
         * @param {function(string)} [onStatus] kullaniciya gosterilecek durum metni
         */
        load: function (url, onStatus) {
            if (!url) {
                return Promise.reject(new App.AppError(App.ERR.PARSE, 'M3U adresi bos'));
            }
            if (onStatus) { onStatus('Playlist indiriliyor...'); }

            return App.Http.getText(url, {
                timeout: 60000,          /* buyuk playlistler icin genis pencere */
                retries: 1,
                onProgress: function (loaded, total) {
                    if (!onStatus) { return; }
                    if (total) {
                        onStatus('Indiriliyor: %' + Math.round(loaded * 100 / total));
                    } else {
                        onStatus('Indiriliyor: ' + Math.round(loaded / 1024) + ' KB');
                    }
                }
            }).then(function (text) {
                if (onStatus) { onStatus('Playlist cozumleniyor...'); }
                return M.parse(text, function (done, total) {
                    if (onStatus && done % 20000 === 0) {
                        onStatus('Cozumleniyor: %' + Math.round(done * 100 / total));
                    }
                });
            });
        }
    };

    App.M3U = M;
})(window.App = window.App || {});
