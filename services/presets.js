/* ============================================================
   services/presets.js
   HAZIR HESAPLAR  (proje klasorundeki hesaplar.txt)

   NEDEN GEREKLI?
   Tizen uygulamayi yeniden kurdugunuzda (her yeni build) kayitli
   playlistleri SILER. Uzun bir M3U linkini her seferinde kumandayla
   yazmak cok zahmetli.

   COZUM: Kullanici linkini bilgisayarda hesaplar.txt dosyasina BIR KEZ
   yazar. Dosya paketin parcasidir; her build'e otomatik girer. Uygulama
   acilisinda dosyayi okur ve kayitli olmayan hesaplari ekler. Hic
   aktif hesap yoksa ilkini etkinlestirir; boylece giris ekrani hic
   gorunmeden dogrudan ana ekran acilir.

   DOSYA BICIMI (her satir bir hesap, "#" ile baslayan satirlar aciklama)
     http://sunucu:8080/get.php?username=U&password=P&type=m3u_plus
     Ev Hesabi | http://sunucu:8080/get.php?username=U&password=P
     Ev Hesabi | http://sunucu:8080 | KULLANICI | SIFRE
     m3u | http://...           (get.php linkini Xtream'e CEVIRME)
     m3u | Liste Adi | http://...
     opensubtitles | API_ANAHTARI [| KULLANICI | SIFRE] [| dil=tr]

   ALTYAZI SERVISI (OpenSubtitles) satiri da her kurulumda otomatik
   kaydedilir. Ayarlar ekranindan elle degistirilirse, dosyadaki satir
   DEGISENE kadar elle girilen korunur (her acilista ezilmez).

   get.php / player_api.php linkleri Xtream hesabina cevrilir: Xtream
   API'si filmleri, dizileri ve rehberi kategorili verir ve dev bir M3U
   dosyasini indirip cozmekten cok daha hizlidir.

   Kullanici uygulama icinden bir hazir hesabi SILERSE, ayni kurulum
   suresince geri eklenmez (hangi hesaplarin eklendigi hatirlanir).
   Yeni bir build kurulunca bu kayit da silindigi icin yeniden eklenir.
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('Presets');
    var U = App.Utils;

    var FILE = 'hesaplar.txt';
    var K_IMPORTED = 'presets.imported';
    var K_SUBS = 'presets.subsApplied';    /* son uygulanan altyazi satirinin ozeti */
    var READ_TIMEOUT = 3000;

    /* ---------------- Dosyayi oku ---------------- */

    /**
     * Paketteki dosyayi XHR ile okur. Tizen'de paket ici dosyalarda
     * basarili yanit status=0 ile gelebilir.
     * @returns {Promise<string>} dosya yoksa bos dizge
     */
    function readViaXhr() {
        return new Promise(function (resolve) {
            var done = false;
            function fin(text) {
                if (done) { return; }
                done = true;
                clearTimeout(guard);
                resolve(text || '');
            }
            var guard = setTimeout(function () { fin(''); }, READ_TIMEOUT);
            try {
                var x = new XMLHttpRequest();
                x.open('GET', FILE, true);
                x.onload = function () {
                    fin((x.status === 200 || x.status === 0) ? x.responseText : '');
                };
                x.onerror = function () { fin(''); };
                x.send();
            } catch (e) {
                fin('');
            }
        });
    }

    /** XHR calismazsa Tizen dosya API'si: paket klasoru (wgt-package) */
    function readViaFs() {
        var fs = window.tizen && tizen.filesystem;
        if (!fs || typeof fs.openFile !== 'function') { return ''; }
        try {
            var fh = fs.openFile('wgt-package/' + FILE, 'r');
            try { return fh.readString(null, 'UTF-8') || ''; }
            finally { fh.close(); }
        } catch (e) {
            return '';
        }
    }

    function readFile() {
        return readViaXhr().then(function (text) {
            return text || readViaFs();
        });
    }

    /* ---------------- Cozumle ---------------- */

    /**
     * get.php / player_api.php linkinden Xtream bilgilerini cikarir.
     * @returns {object|null} {host, username, password}
     */
    function xtreamFromUrl(url) {
        var m = /^(https?:\/\/[^?#]+?)\/(?:get|player_api)\.php\?([^#]*)/i.exec(url);
        if (!m) { return null; }
        var q = {};
        var pairs = m[2].split('&');
        for (var i = 0; i < pairs.length; i++) {
            var kv = pairs[i].split('=');
            var k = decodeSafe(kv[0]).toLowerCase();
            q[k] = decodeSafe(kv.slice(1).join('='));
        }
        if (!q.username || !q.password) { return null; }
        return { host: m[1], username: q.username, password: q.password };
    }

    function decodeSafe(s) {
        try { return decodeURIComponent(String(s || '').replace(/\+/g, ' ')); }
        catch (e) { return String(s || ''); }
    }

    function isUrl(s) { return /^https?:\/\//i.test(s); }

    /**
     * Tek satiri profil nesnesine cevirir.
     * @returns {object|null} Profiles.save() bicimi
     */
    function parseLine(line) {
        var parts = line.split('|');
        for (var i = 0; i < parts.length; i++) { parts[i] = parts[i].trim(); }
        parts = parts.filter(function (p) { return p !== ''; });
        if (!parts.length) { return null; }

        /* Altyazi servisi: opensubtitles | ANAHTAR [| KULLANICI | SIFRE] [| dil=tr] */
        if (/^(opensubtitles|altyazi)$/i.test(parts[0])) {
            return parseSubtitleLine(parts.slice(1));
        }

        /* Bastaki "m3u" / "xtream" sozcugu tur belirtir, ad degildir */
        var forced = '';
        if (/^(m3u|xtream)$/i.test(parts[0])) {
            forced = parts.shift().toLowerCase();
        }

        /* Xtream: [ad |] sunucu | kullanici | sifre */
        if (parts.length >= 3 && isUrl(parts[parts.length - 3]) && !isUrl(parts[parts.length - 1])) {
            return {
                type: 'xtream',
                name: parts.length >= 4 ? parts[0] : '',
                host: parts[parts.length - 3],
                username: parts[parts.length - 2],
                password: parts[parts.length - 1]
            };
        }

        /* Link: [ad |] link */
        var url = parts[parts.length - 1];
        if (!isUrl(url)) { return null; }
        var name = parts.length >= 2 ? parts[0] : '';

        var xt = (forced !== 'm3u') ? xtreamFromUrl(url) : null;
        if (xt) {
            return { type: 'xtream', name: name, host: xt.host, username: xt.username, password: xt.password };
        }
        return { type: 'm3u', name: name, m3uUrl: url, epgUrl: '' };
    }

    /** @returns {object|null} {type:'opensubtitles', apiKey, username, password, language} */
    function parseSubtitleLine(parts) {
        var language = '';
        var rest = [];
        for (var i = 0; i < parts.length; i++) {
            var m = /^dil\s*=\s*([a-z]{2,3})$/i.exec(parts[i]);
            if (m) { language = m[1].toLowerCase(); }
            else { rest.push(parts[i]); }
        }
        if (!rest.length || isUrl(rest[0])) { return null; }
        return {
            type: 'opensubtitles',
            apiKey: rest[0],
            username: rest[1] || '',
            password: rest[2] || '',
            language: language
        };
    }

    /**
     * @returns {Array<object>} hesaplar (Profiles.save bicimi) ve varsa
     *          type:'opensubtitles' kaydi
     */
    function parse(text) {
        var out = [];
        var lines = String(text || '').replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line || line.charAt(0) === '#' || line.indexOf('//') === 0) { continue; }
            var p = parseLine(line);
            if (p) { out.push(p); }
            else { log.warn('hesaplar.txt satiri anlasilamadi (satir ' + (i + 1) + ')'); }
        }
        return out;
    }

    /* ---------------- Ice aktar ---------------- */

    function signature(p) {
        return p.type === 'xtream'
            ? ('x|' + U.normalizeHost(p.host).toLowerCase() + '|' + p.username)
            : ('m|' + String(p.m3uUrl || '').trim());
    }

    function findExisting(sig) {
        var list = App.Profiles.list();
        for (var i = 0; i < list.length; i++) {
            if (signature(list[i]) === sig) { return list[i]; }
        }
        return null;
    }

    /**
     * Cozumlenmis hesaplari kaydeder.
     * @returns {{found, added, updated, activated}}
     */
    /**
     * Altyazi servisi satirini uygular.
     * Yalnizca satir, en son uygulanandan FARKLIYSA yazar: yeni kurulumda
     * (kayit bos) veya dosya duzenlenince. Boylece kullanici Ayarlar'dan
     * elle degistirirse her acilista dosya degeriyle ezilmez.
     * @returns {boolean} yapilandirma degisti mi
     */
    function applySubtitles(cfg) {
        if (!cfg || !App.OpenSubtitles) { return false; }
        var sum = U.hash([cfg.apiKey, cfg.username, cfg.password, cfg.language].join('\n'));
        if (App.Storage.get(K_SUBS, '') === sum) { return false; }

        var cur = App.OpenSubtitles.getConfig();
        var same = cur.apiKey === cfg.apiKey && cur.username === cfg.username &&
                   cur.password === cfg.password && (!cfg.language || cur.language === cfg.language);
        if (!same) {
            App.OpenSubtitles.saveConfig({
                apiKey: cfg.apiKey,
                username: cfg.username,
                password: cfg.password,
                language: cfg.language
            });
        }
        App.Storage.trySet(K_SUBS, sum);
        return !same;
    }

    function importAll(entries) {
        /* Altyazi kaydini hesaplardan ayir (birden fazlaysa sonuncusu gecerli) */
        var subs = null;
        var accounts = [];
        for (var s = 0; s < entries.length; s++) {
            if (entries[s].type === 'opensubtitles') { subs = entries[s]; }
            else { accounts.push(entries[s]); }
        }
        entries = accounts;

        var res = { found: entries.length, added: 0, updated: 0, activated: false, subtitles: false };
        res.subtitles = applySubtitles(subs);
        if (!entries.length) { return res; }

        var imported = App.Storage.get(K_IMPORTED, {}) || {};
        var firstId = null;

        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            var sig = signature(e);
            var ex = findExisting(sig);

            if (ex) {
                /* Ayni hesap kayitli: dosyada sifre degistiyse guncelle */
                if (e.type === 'xtream') {
                    var full = App.Profiles.get(ex.id);
                    if (full && full.password !== e.password) {
                        App.Profiles.save({
                            id: ex.id, name: e.name || ex.name, type: 'xtream',
                            host: e.host, username: e.username, password: e.password
                        });
                        res.updated++;
                    }
                }
                imported[sig] = true;
                if (!firstId) { firstId = ex.id; }
                continue;
            }

            /* Kullanici bu kurulumda silmis: geri ekleme */
            if (imported[sig]) { continue; }

            var id = App.Profiles.save(e);
            imported[sig] = true;
            res.added++;
            if (!firstId) { firstId = id; }
        }

        App.Storage.trySet(K_IMPORTED, imported);

        if (!App.Profiles.activeId() && firstId) {
            App.Profiles.setActive(firstId);
            res.activated = true;
        }
        return res;
    }

    App.Presets = {
        FILE: FILE,
        parse: parse,
        importAll: importAll,

        /**
         * hesaplar.txt'yi oku ve hesaplari ekle. Asla reddetmez; dosya
         * yoksa veya bossa sessizce { found: 0 } doner.
         * @returns {Promise<object>}
         */
        load: function () {
            return readFile().then(function (text) {
                var entries = parse(text);
                var res = importAll(entries);
                if (res.found) {
                    log.info('hesaplar.txt:', res.found, 'hesap,', res.added, 'eklendi,',
                             res.updated, 'guncellendi', res.activated ? '(etkinlestirildi)' : '');
                }
                if (res.subtitles) { log.info('hesaplar.txt: altyazi servisi ayarlandi'); }
                return res;
            })['catch'](function (e) {
                log.warn('hesaplar.txt okunamadi', e && e.message);
                return { found: 0, added: 0, updated: 0, activated: false, subtitles: false };
            });
        }
    };
})(window.App = window.App || {});
