/* ============================================================
   services/backup.js
   YEDEKLE / GERI YUKLE

   NEDEN GEREKLI?
   Tizen bir .wgt paketini yeniden kurarken uygulamanin localStorage
   verisini SILER. Bu yuzden her yeni build sonrasi kaydedilmis
   playlistler, favoriler ve gecmis kayboluyordu.

   COZUM: Veriler uygulama disindaki bir klasore JSON olarak yazilir.
   Bu klasorler uygulama kaldirilsa bile silinmez:

     removable/<USB>   -> USB bellek        (EN GUVENILIR, TV'ler arasi tasinir)
     downloads         -> TV indirilenler klasoru
     documents         -> TV belgeler klasoru

   KULLANILAN TIZEN API'SI: tizen.filesystem
     tizen.filesystem.listStorages(cb)          -> baglı depolamalari listeler
     tizen.filesystem.resolve(root, cb, err, 'rw')
     dir.createFile(name) / file.openStream('w'|'r', cb, err, 'UTF-8')
   Gerekli privilege'lar config.xml'de tanimlidir:
     http://tizen.org/privilege/filesystem.read
     http://tizen.org/privilege/filesystem.write

   PC tarayicisinda tizen.filesystem yoktur; bu durumda yedek metni
   ekranda gosterilir/kopyalanabilir bicimde dondurulur.
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('Backup');
    var U = App.Utils;

    var FILE_NAME = 'iptv-player-yedek.json';
    var FORMAT_VERSION = 1;

    function fsApi() {
        return (window.tizen && tizen.filesystem) ? tizen.filesystem : null;
    }

    /* ---------------- Yedek icerigi ---------------- */

    /**
     * Yedeklenecek her seyi tek bir nesnede toplar.
     * Sifreler DUZ METIN olarak yazilir; yedek dosyasi kullanicinin
     * kendi USB bellegindedir ve baska bir cihaza tasinabilmesi icin
     * cozulmus olmasi gerekir. Bu, ekranda acikca uyarilir.
     */
    function collect() {
        var profiles = App.Profiles.list();
        var full = [];
        for (var i = 0; i < profiles.length; i++) {
            var p = App.Profiles.get(profiles[i].id);
            if (p) { full.push(p); }
        }

        return {
            app: 'IPTV Player',
            version: FORMAT_VERSION,
            createdAt: new Date().toISOString(),
            profiles: full,
            activeId: App.Profiles.activeId(),
            favorites: App.Favorites.list(),
            history: App.History.list(),
            settings: App.Settings.get()
        };
    }

    /**
     * Yedegi uygular.
     * @param {object} data
     * @param {object} opts {profiles, favorites, history, settings} (hepsi varsayilan true)
     * @returns {object} ozet
     */
    function apply(data, opts) {
        opts = opts || {};
        if (!data || data.app !== 'IPTV Player' || !data.version) {
            throw new App.AppError(App.ERR.PARSE, 'gecerli bir IPTV Player yedegi degil');
        }

        var summary = { profiles: 0, favorites: 0, history: 0, settings: false };

        /* --- Playlistler (kopyalari birlestir) --- */
        if (opts.profiles !== false && data.profiles && data.profiles.length) {
            var existing = App.Profiles.list();
            for (var i = 0; i < data.profiles.length; i++) {
                var p = data.profiles[i];
                if (!p || !p.type) { continue; }

                /* Ayni hesap zaten kayitliysa tekrar ekleme */
                var dup = false;
                for (var j = 0; j < existing.length; j++) {
                    var e = existing[j];
                    if (e.type !== p.type) { continue; }
                    if (p.type === 'xtream' && e.host === p.host && e.username === p.username) { dup = true; break; }
                    if (p.type === 'm3u' && e.m3uUrl === p.m3uUrl) { dup = true; break; }
                }
                if (dup) { continue; }

                App.Profiles.save({
                    name: p.name, type: p.type, host: p.host, username: p.username,
                    password: p.password, m3uUrl: p.m3uUrl, epgUrl: p.epgUrl
                });
                summary.profiles++;
            }
        }

        /* --- Favoriler --- */
        if (opts.favorites !== false && data.favorites && data.favorites.length) {
            for (var f = 0; f < data.favorites.length; f++) {
                if (App.Favorites.add(data.favorites[f])) { summary.favorites++; }
            }
        }

        /* --- Izleme gecmisi --- */
        if (opts.history !== false && data.history && data.history.length) {
            /* En eskiden yeniye ekle ki siralama korunsun */
            for (var h = data.history.length - 1; h >= 0; h--) {
                var rec = data.history[h];
                App.History.push(rec);
                if (rec.position) {
                    App.History.updatePosition(rec.key, rec.position, rec.duration);
                }
                summary.history++;
            }
        }

        /* --- Ayarlar --- */
        if (opts.settings !== false && data.settings) {
            for (var k in data.settings) {
                if (Object.prototype.hasOwnProperty.call(data.settings, k) &&
                    Object.prototype.hasOwnProperty.call(App.Settings.DEFAULTS, k)) {
                    App.Settings.set(k, data.settings[k]);
                }
            }
            summary.settings = true;
        }

        log.info('yedek uygulandi', JSON.stringify(summary));
        return summary;
    }

    /* ---------------- Dosya sistemi ---------------- */

    /**
     * Yazilabilir hedef klasorleri sirayla dener.
     * @returns {Promise<Array<{label, dir}>>}
     */
    function listTargets() {
        var fs = fsApi();
        if (!fs) {
            return Promise.reject(new App.AppError(App.ERR.UNSUPPORTED,
                'tizen.filesystem yok (PC tarayici modu)'));
        }

        var candidates = [];

        return new Promise(function (resolve) {
            /* Once takili USB bellekleri bul */
            try {
                fs.listStorages(function (storages) {
                    for (var i = 0; i < storages.length; i++) {
                        var st = storages[i];
                        if (st.type === 'EXTERNAL' && st.state === 'MOUNTED') {
                            candidates.push({ label: 'USB: ' + st.label, root: st.label });
                        }
                    }
                    resolve(candidates);
                }, function () { resolve(candidates); });
            } catch (e) {
                resolve(candidates);
            }
        }).then(function (usb) {
            /* Ardindan TV'nin standart klasorleri */
            var roots = usb.concat([
                { label: 'Indirilenler', root: 'downloads' },
                { label: 'Belgeler', root: 'documents' }
            ]);

            var resolved = [];
            var chain = Promise.resolve();

            roots.forEach(function (r) {
                chain = chain.then(function () {
                    return new Promise(function (res) {
                        try {
                            fs.resolve(r.root, function (dir) {
                                resolved.push({ label: r.label, dir: dir });
                                res();
                            }, function () { res(); }, 'rw');
                        } catch (e2) { res(); }
                    });
                });
            });

            return chain.then(function () {
                if (!resolved.length) {
                    throw new App.AppError(App.ERR.UNSUPPORTED,
                        'yazilabilir klasor bulunamadi (USB takili mi?)');
                }
                return resolved;
            });
        });
    }

    function writeFile(dir, text) {
        return new Promise(function (resolve, reject) {
            var file;
            try {
                /* Varsa uzerine yaz */
                try { file = dir.resolve(FILE_NAME); }
                catch (e) { file = dir.createFile(FILE_NAME); }
            } catch (e2) {
                return reject(new App.AppError(App.ERR.STORAGE, 'dosya olusturulamadi: ' + (e2 && e2.message)));
            }

            try {
                file.openStream('w', function (stream) {
                    try {
                        stream.write(text);
                        stream.close();
                        resolve(file.toURI ? file.toURI() : FILE_NAME);
                    } catch (e3) {
                        reject(new App.AppError(App.ERR.STORAGE, 'yazma hatasi: ' + (e3 && e3.message)));
                    }
                }, function (err) {
                    reject(new App.AppError(App.ERR.STORAGE, 'akis acilamadi: ' + (err && err.name)));
                }, 'UTF-8');
            } catch (e4) {
                reject(new App.AppError(App.ERR.STORAGE, (e4 && e4.message) || 'yazma hatasi'));
            }
        });
    }

    function readFile(dir) {
        return new Promise(function (resolve, reject) {
            var file;
            try {
                file = dir.resolve(FILE_NAME);
            } catch (e) {
                return reject(new App.AppError(App.ERR.NOT_FOUND, FILE_NAME + ' bulunamadi'));
            }
            try {
                file.openStream('r', function (stream) {
                    try {
                        var text = stream.read(file.fileSize || 5000000);
                        stream.close();
                        resolve(text);
                    } catch (e2) {
                        reject(new App.AppError(App.ERR.STORAGE, 'okuma hatasi'));
                    }
                }, function (err) {
                    reject(new App.AppError(App.ERR.STORAGE, 'akis acilamadi: ' + (err && err.name)));
                }, 'UTF-8');
            } catch (e3) {
                reject(new App.AppError(App.ERR.STORAGE, (e3 && e3.message) || 'okuma hatasi'));
            }
        });
    }

    var B = {
        FILE_NAME: FILE_NAME,

        isAvailable: function () { return !!fsApi(); },

        collect: collect,
        apply: apply,

        /** Yedegi metin olarak dondurur (dosyaya yazmadan) */
        toText: function () { return JSON.stringify(collect(), null, 1); },

        listTargets: listTargets,

        /**
         * Yedegi diske yaz.
         * @returns {Promise<{path, label, bytes}>}
         */
        save: function () {
            var text = B.toText();
            return listTargets().then(function (targets) {
                var t = targets[0];    /* USB varsa o, yoksa Indirilenler */
                return writeFile(t.dir, text).then(function (path) {
                    log.info('yedek yazildi:', t.label, path);
                    return { path: path, label: t.label, bytes: text.length };
                });
            });
        },

        /**
         * Diskteki yedegi oku ve uygula.
         * @returns {Promise<object>} ozet
         */
        restore: function (opts) {
            return listTargets().then(function (targets) {
                /* Dosyayi bulana kadar hedefleri sirayla dene */
                var idx = 0;
                function tryNext() {
                    if (idx >= targets.length) {
                        throw new App.AppError(App.ERR.NOT_FOUND,
                            FILE_NAME + ' hicbir klasorde bulunamadi');
                    }
                    var t = targets[idx++];
                    return readFile(t.dir).then(function (text) {
                        return { text: text, label: t.label };
                    }, function () { return tryNext(); });
                }
                return tryNext();
            }).then(function (found) {
                var data;
                try { data = JSON.parse(found.text); }
                catch (e) { throw new App.AppError(App.ERR.PARSE, 'yedek dosyasi bozuk'); }
                var summary = apply(data, opts);
                summary.label = found.label;
                summary.createdAt = data.createdAt;
                return summary;
            });
        }
    };

    App.Backup = B;
})(window.App = window.App || {});
