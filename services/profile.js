/* ============================================================
   services/profile.js
   KAYITLI PLAYLISTLER + AKTIF HESAP

   Iki API vardir:

     App.Profiles  -> kaydedilmis TUM playlistlerin koleksiyonu
                      (ekle / duzenle / sil / aktif yap)
     App.Profile   -> AKTIF playlist. Uygulamanin geri kalani
                      yalnizca bunu kullanir; boylece coklu playlist
                      destegi diger dosyalari etkilemez.

   Desteklenen kaynak turleri:
     type = 'xtream'  -> host + username + password
     type = 'm3u'     -> m3uUrl (+ istege bagli epgUrl)

   SIFRE: App.Storage.setSecret() ile profil basina ayri saklanir
   (bkz. js/core/storage.js). Bu SIFRELEME degildir; duz metin
   gorunmesini engelleyen bir gizlemedir - Tizen TV web profilinde
   gercek bir keystore API'si yoktur.
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('Profile');
    var U = App.Utils;

    var K_LIST = 'profiles';           /* [{id, name, type, ...}] */
    var K_ACTIVE = 'profiles.active';  /* aktif profilin id'si */
    var K_SECRET = 'profile.secret.';  /* + id */
    var K_USERINFO = 'profile.userinfo.'; /* + id */

    /* Eski tek-profilli surumden gecis icin */
    var K_OLD_PROFILE = 'profile';
    var K_OLD_SECRET = 'profile.secret';
    var K_OLD_USERINFO = 'profile.userinfo';

    var listCache = null;
    var activeCache = null;

    function newId() {
        return 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    }

    /** Eski surumun tek profilini yeni listeye tasi (bir kez calisir) */
    function migrate() {
        var old = App.Storage.get(K_OLD_PROFILE, null);
        if (!old || !old.type) { return false; }

        var pass = App.Storage.getSecret(K_OLD_SECRET) || '';
        var id = newId();
        var entry = {
            id: id,
            name: old.name || (old.type === 'xtream' ? (old.username || 'Xtream') : 'M3U Listesi'),
            type: old.type,
            host: old.host || '',
            username: old.username || '',
            m3uUrl: old.m3uUrl || '',
            epgUrl: old.epgUrl || '',
            createdAt: old.savedAt || Date.now(),
            lastUsedAt: Date.now()
        };

        App.Storage.set(K_LIST, [entry]);
        App.Storage.setSecret(K_SECRET + id, pass);
        App.Storage.set(K_ACTIVE, id);

        var ui = App.Storage.get(K_OLD_USERINFO, null);
        if (ui) { App.Storage.trySet(K_USERINFO + id, ui); }

        App.Storage.remove(K_OLD_PROFILE);
        App.Storage.remove(K_OLD_SECRET);
        App.Storage.remove(K_OLD_USERINFO);

        log.info('eski profil yeni playlist listesine tasindi');
        return true;
    }

    function loadList() {
        if (listCache) { return listCache; }
        if (!App.Storage.has(K_LIST)) { migrate(); }
        listCache = App.Storage.get(K_LIST, []) || [];
        return listCache;
    }

    function persistList() {
        App.Storage.set(K_LIST, listCache || []);
        App.Bus.emit('profiles:change', listCache);
    }

    function findIndex(id) {
        var l = loadList();
        for (var i = 0; i < l.length; i++) { if (l[i].id === id) { return i; } }
        return -1;
    }

    /** Profil kaydini sifresiyle birlikte doldurur */
    function hydrate(entry) {
        if (!entry) { return null; }
        var copy = {};
        for (var k in entry) {
            if (Object.prototype.hasOwnProperty.call(entry, k)) { copy[k] = entry[k]; }
        }
        copy.password = App.Storage.getSecret(K_SECRET + entry.id) || '';
        return copy;
    }

    /* ==================================================================
       App.Profiles - koleksiyon
       ================================================================== */
    var Profiles = {
        list: function () { return loadList().slice(); },

        count: function () { return loadList().length; },

        /** @returns {object|null} sifre DAHIL profil */
        get: function (id) {
            var i = findIndex(id);
            return i === -1 ? null : hydrate(loadList()[i]);
        },

        /** Sifresiz kayit (liste gosterimi icin yeterli) */
        meta: function (id) {
            var i = findIndex(id);
            return i === -1 ? null : loadList()[i];
        },

        /**
         * Ekle veya guncelle.
         * @param {object} p {id?, name, type, host, username, password, m3uUrl, epgUrl}
         * @returns {string} id
         */
        save: function (p) {
            var l = loadList();
            var id = p.id || newId();
            var isNew = findIndex(id) === -1;

            var entry = {
                id: id,
                name: (p.name || '').trim() ||
                      (p.type === 'xtream' ? (p.username || 'Xtream Hesabi') : 'M3U Listesi'),
                type: p.type,
                host: p.type === 'xtream' ? U.normalizeHost(p.host) : '',
                username: p.username || '',
                m3uUrl: (p.m3uUrl || '').trim(),
                epgUrl: (p.epgUrl || '').trim(),
                createdAt: isNew ? Date.now() : (Profiles.meta(id).createdAt || Date.now()),
                lastUsedAt: Date.now()
            };

            if (isNew) { l.push(entry); }
            else { l[findIndex(id)] = entry; }

            persistList();
            if (p.password !== undefined) {
                App.Storage.setSecret(K_SECRET + id, p.password || '');
            }
            activeCache = null;
            log.info(isNew ? 'playlist eklendi:' : 'playlist guncellendi:', entry.name);
            return id;
        },

        /** Yalnizca adi degistir */
        rename: function (id, name) {
            var i = findIndex(id);
            if (i === -1) { return false; }
            listCache[i].name = (name || '').trim() || listCache[i].name;
            persistList();
            activeCache = null;
            return true;
        },

        remove: function (id) {
            var i = findIndex(id);
            if (i === -1) { return false; }

            /* Bu hesaba ait onbellegi de temizle */
            App.Cache.invalidate(Profiles.cacheIdOf(id));
            App.Storage.remove(K_SECRET + id);
            App.Storage.remove(K_USERINFO + id);

            listCache.splice(i, 1);
            persistList();

            if (App.Storage.get(K_ACTIVE, null) === id) {
                App.Storage.remove(K_ACTIVE);
                activeCache = null;
                App.Bus.emit('profile:change', null);
            }
            return true;
        },

        activeId: function () { return App.Storage.get(K_ACTIVE, null); },

        setActive: function (id) {
            if (findIndex(id) === -1) { return false; }
            App.Storage.set(K_ACTIVE, id);
            var i = findIndex(id);
            listCache[i].lastUsedAt = Date.now();
            persistList();
            activeCache = null;
            App.Bus.emit('profile:change', Profiles.get(id));
            return true;
        },

        /** Onbellek anahtari - hesap degisince eski veri kullanilmasin */
        cacheIdOf: function (id) {
            var m = Profiles.meta(id);
            if (!m) { return 'none'; }
            var base = m.type === 'xtream' ? (m.host + '|' + m.username) : m.m3uUrl;
            return m.type + '_' + U.hash(base);
        },

        /**
         * Baska bir cihaza aktarmak icin tasinabilir playlist adresi.
         * Xtream hesaplari icin standart get.php M3U baglantisi uretilir;
         * bu adres her IPTV oynaticida calisir.
         * DIKKAT: Adres kullanici adi ve sifreyi ICERIR.
         */
        shareUrl: function (id) {
            var p = Profiles.get(id);
            if (!p) { return ''; }
            if (p.type === 'm3u') { return p.m3uUrl; }
            if (!p.host || !p.username) { return ''; }
            return p.host + '/get.php?' + U.buildQuery({
                username: p.username,
                password: p.password,
                type: 'm3u_plus',
                output: 'ts'
            });
        }
    };

    /* ==================================================================
       App.Profile - aktif hesap (eski API ile birebir uyumlu)
       ================================================================== */
    function loadActive() {
        if (activeCache) { return activeCache; }
        var id = Profiles.activeId();
        if (!id) { return null; }
        activeCache = Profiles.get(id);
        return activeCache;
    }

    var P = {
        /** @returns {object|null} aktif profil (sifre dahil) */
        get: function () { return loadActive(); },

        isLoggedIn: function () {
            var p = loadActive();
            if (!p) { return false; }
            if (p.type === 'xtream') { return !!(p.host && p.username); }
            if (p.type === 'm3u') { return !!p.m3uUrl; }
            return false;
        },

        /** Kaydet + aktif yap (giris ekrani bunu kullanir) */
        save: function (p) {
            var id = Profiles.save(p);
            App.Storage.set(K_ACTIVE, id);
            activeCache = null;
            var active = loadActive();
            App.Bus.emit('profile:change', active);
            return active;
        },

        /** Xtream login sonrasi donen hesap bilgileri (bitis tarihi vb.) */
        setUserInfo: function (info) {
            var id = Profiles.activeId();
            if (!id) { return; }
            App.Storage.trySet(K_USERINFO + id, info || null);
            App.Bus.emit('profile:userinfo', info);
        },

        getUserInfo: function () {
            var id = Profiles.activeId();
            return id ? App.Storage.get(K_USERINFO + id, null) : null;
        },

        /** Onbellek anahtarlarini hesaba baglar */
        id: function () {
            var id = Profiles.activeId();
            return id ? Profiles.cacheIdOf(id) : 'none';
        },

        key: function (suffix) { return P.id() + '.' + suffix; },

        /**
         * Cikis: aktif secim kaldirilir. KAYITLI PLAYLISTLER SILINMEZ -
         * kullanici "Playlistlerim" ekranindan tekrar secebilir.
         */
        logout: function () {
            var id = Profiles.activeId();
            if (id) { App.Cache.invalidate(Profiles.cacheIdOf(id)); }
            App.Storage.remove(K_ACTIVE);
            activeCache = null;
            log.info('aktif hesaptan cikildi');
            App.Bus.emit('profile:change', null);
        },

        /** Fabrika ayarlari: her sey silinir */
        wipe: function () {
            App.Storage.clearAll();
            listCache = null;
            activeCache = null;
            App.Bus.emit('profiles:change', []);
            App.Bus.emit('profile:change', null);
        },

        invalidate: function () { listCache = null; activeCache = null; }
    };

    App.Profiles = Profiles;
    App.Profile = P;
})(window.App = window.App || {});
