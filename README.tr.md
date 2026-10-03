<div align="center">

# IPTV Player

**Samsung Smart TV (Tizen OS) için ücretsiz, reklamsız, açık kaynaklı IPTV oynatıcı**

Xtream Codes ve M3U desteği · Donanım video oynatma (AVPlay) · Tamamen kumanda odaklı arayüz

![Platform](https://img.shields.io/badge/platform-Samsung%20Tizen%20TV-1428A0)
![Hedef](https://img.shields.io/badge/hedef-Tizen%209.0-0A7EA4)
![JavaScript](https://img.shields.io/badge/JavaScript-ES5-F7DF1E)
![Bağımlılık](https://img.shields.io/badge/çalışma%20zamanı%20bağımlılığı-yok-brightgreen)
![Reklam](https://img.shields.io/badge/reklam-yok-brightgreen)

[English](README.md) · **Türkçe**

</div>

---

> [!IMPORTANT]
> Bu uygulama **hiçbir kanal veya içerik sağlamaz.** Yalnızca kullanıcının yasal olarak
> erişim hakkına sahip olduğu IPTV yayınlarını oynatır. Kodda hiçbir gerçek sunucu adresi
> veya hesap bilgisi bulunmaz; tüm örnekler `http://SERVER:PORT`, `USERNAME`, `PASSWORD`
> gibi yer tutuculardır. İçeriğin yasal sorumluluğu kullanıcıya aittir.

Android TV için değil, Samsung'un **Tizen OS** işletim sistemi için yazılmıştır. Framework
kullanmaz; saf HTML5, CSS3 ve ES5 JavaScript'tir. Lisans, aktivasyon, hesap veya telemetri
yoktur.

## İçindekiler

- [Son güncellemeler](#son-güncellemeler)
- [Özellikler](#özellikler)
- [Hızlı başlangıç](#hızlı-başlangıç)
- [Kullanım](#kullanım)
- [Kumanda tuşları](#kumanda-tuşları)
- [Mimari](#mimari)
- [Performans tasarımı](#performans-tasarımı)
- [Kullanılan Samsung / Tizen API'leri](#kullanılan-samsung--tizen-apileri)
- [Hata yönetimi](#hata-yönetimi)
- [İnternetten altyazı (OpenSubtitles)](#internetten-altyazı-opensubtitles)
- [Veri saklama ve gizlilik](#veri-saklama-ve-gizlilik)
- [Testler](#testler)
- [Bilinen sınırlar](#bilinen-sınırlar)
- [Katkıda bulunma](#katkıda-bulunma)
- [Lisans](#lisans)

---

## Son güncellemeler

**Hesap bir kez girilir — `hesaplar.txt`**
- Linkinizi bilgisayarda proje klasöründeki `hesaplar.txt` dosyasına bir kez yapıştırın.
  Dosya her build'e girer; yeni kurulumda uygulama hesabı kendisi ekler ve giriş ekranı
  açılmaz. Ayrıntılar: [hesaplar.txt](#hesabınızı-her-buildde-yeniden-girmeyin-hesaplartxt).
- Aynı dosyaya `opensubtitles | API_ANAHTARI` satırı eklenirse altyazı servisi de her
  kurulumda kendiliğinden ayarlanır.
- Açılışta "hesaplar.txt: hesap eklendi, altyazı servisi ayarlandı" bildirimi çıkar;
  giriş ekranında da bu özellik hatırlatılır.

**İleri/geri sarmada donma giderildi**
- AVPlay'in `seekTo` işlemi sürerken başka komut kabul etmediği (Samsung dokümanı)
  dikkate alınmıyordu: ard arda sarma, sarma sırasında duraklatma veya parça listesi
  okuma görüntüyü donduruyordu. Artık sarma sürerken gelen komutlar sıraya alınır,
  sarma bitince uygulanır.
- Ard arda basılan sarmalar ve ⏪ ⏩ tuşları birikir, **tek sarma** yapılır.
- Sarma, sürmekte olan sarmanın **hedefinden** devam eder (eskiden eski konumdan
  hesaplanıp geri atlayabiliyordu).
- Tampon değerleri Samsung'un alt sınırına (4 sn) çekildi; sarmadan sonra takılma azaldı.
- Ağ kesilip yayın yeniden başlatılınca film/bölüm **kaldığı yerden** devam eder.
- Sarma sonrası kısa beklemede ekranı kaplayan kutu yerine küçük bir gösterge çıkar.

**Tasarım düzeltmeleri**
- Dizi/film ızgarasında seçili afiş artık **aşağı yukarı kaymaz**: ekrana tam iki satır
  sığar, seçili satır hep aynı yerde durur, sütun sayısı ekrana göre hesaplanır.
- Afiş odak çerçevesi resmin **üstünde** çizilir (eskiden resmin arkasında kalıyordu).
- Altyazı seçim listesinde aşağı inince liste artık **yukarı fırlamaz**; uzun listelerde
  "7 / 20" sayacı gösterilir.
- Ekrandaki altyazı, bilgi şeridi açılınca zıplamak yerine yumuşakça yukarı kayar.
- Kolon başlıkları ilk satırın üstüne binmiyor; alt ipucu çubuğu içeriğe binmiyor.
- Ayarlar ekranında liste sağ paneli kaplamıyor; bir ayarı değiştirince liste zıplamıyor.
- Giriş ve Altyazı Servisi ekranları iki sütunlu karta geçti ve 1080p ekrana tam sığıyor.
- Kategori arama kutusu kolon başlığına taşındı; afişlere daha çok yer kaldı.
- Oynatıcıda bildirimler "Intro'yu Atla" / "Sonraki bölüm" kartlarının üstüne binmiyor.

**Diğer düzeltmeler**
- Canlı TV'de KIRMIZI (yenile) tuşu hata veriyordu ve arama filtresini yok sayıyordu.
- Canlı yayında duraklatma desteklenmiyorsa ekranda yanlışlıkla "Duraklatıldı"
  yazmıyor; kullanıcıya açıkça söyleniyor.
- Hızlı kanal değiştirirken eski kanalın geç gelen sonucu yeni kanalı bozmuyor.

---

## Özellikler

### Giriş ve playlist yönetimi

- **Xtream Codes API** — sunucu URL + kullanıcı adı + şifre
- **M3U / M3U8** — doğrudan playlist adresi (+ isteğe bağlı XMLTV EPG adresi)
- **`hesaplar.txt`** — linki (ve isteğe bağlı OpenSubtitles anahtarını) bilgisayarda bir kez
  yazın; her build'de hesap ve altyazı servisi otomatik kurulur
- **Birden fazla playlist** kaydedin, tek tuşla geçin (*Playlistlerim* ekranı)
- Her playlist için **QR kodu** — telefona aktarın veya başka cihaza taşıyın
- **USB'ye yedekle / geri yükle** — uygulamayı yeniden kurunca veriler kaybolmasın
- Şifre varsayılan olarak gizli, "Şifreyi göster" ile açılır

### İçerik

- **Canlı TV** — kategoriler, kanallar, logolar, kanal numaraları, EPG (şimdi / sonra)
- **Filmler (VOD)** — kategoriler, afişler, detay (özet, süre, oyuncular, puan)
- **Diziler** — kategoriler, sezonlar, bölümler, bölüm özetleri
- **M3U'da otomatik dizi tespiti** — `Dizi Adı S01 E05`, `1x05`, `Sezon 1 Bölüm 5` gibi
  kalıplar tanınır; bölümler dizilere gruplanır ve Filmler bölümünü kirletmez
- **Kategori sırası korunur** — sağlayıcının playlistteki sırası bozulmaz
  (TR kanalları neredeyse her zaman en üsttedir, alfabetik sıralama bunu bozardı)
- Favoriler (kanal / film / dizi / bölüm)
- Son izlenenler + **kaldığı yerden devam etme**
- Kategori içinde arama ve genel arama (Türkçe karakter duyarsız: "guclu" ↔ "güçlü")
- Hesap bilgileri: durum, **bitiş tarihi**, kalan gün, eşzamanlı bağlantı sayısı

### Oynatıcı

- Samsung **AVPlay** (`webapis.avplay`) donanım oynatıcısı; HLS `.m3u8`, MPEG-TS `.ts`, MP4, MKV
- Bir format açılmazsa **otomatik olarak diğerini dener** (`.m3u8` ↔ `.ts`)
- **Hızlanan ileri/geri sarma** — art arda bastıkça adım büyür
  (10 sn → 30 sn → 1 dk → 2 dk → 5 dk), tuşu bırakınca tek seferde atlar
- **Donmayan sarma** — AVPlay sarma sürerken başka komut kabul etmez; sarma sırasında
  gelen sarma/duraklatma/parça seçimi sıraya alınır, ara hedefler atlanıp yalnızca sonuncusu
  uygulanır
- Ağ kopmasında veya MAVİ tuşla yeniden başlatmada film/bölüm **kaldığı yerden** devam eder
- **Otomatik sonraki bölüm** — son saniyelerde geri sayımlı kart;
  sezon değişiyorsa otomatik geçmez, sorar
- **İntro'yu atla** önerisi (OK ile)
- Çoklu **ses** ve **altyazı** seçimi — seçili parça ✔ ile işaretlenir,
  dil kodları Türkçe adlara çevrilir (`tur` → Türkçe)
- **Altyazı ekrana uygulama tarafından çizilir** (AVPlay altyazıyı kendisi çizmez),
  kalın konturlu ve TV'de okunaklı; bilgi şeridi açılınca yumuşakça yukarı kayar
- **Seçilen ses/altyazı dili hatırlanır** ve sonraki içeriklerde otomatik uygulanır
  (indeks değil dil kodu saklanır, çünkü indeks her dosyada değişir)
- **İnternetten altyazı indirme** (OpenSubtitles) — [ayrıntılar aşağıda](#internetten-altyazı-opensubtitles)
- Kanal numarasıyla hızlı geçiş, 4K modu, görüntü oranı seçimi
- Hata durumunda Türkçe mesaj + **Tekrar Dene / Sonraki Kanal / Geri Dön**

### Arayüz

- Koyu tema, yüksek kontrast, 3–4 metreden okunabilir büyük fontlar
- Belirgin odak göstergesi — hangi öğenin seçili olduğu her zaman net; afişlerde
  çerçeve resmin üstünde çizilir, odakta yazı kalınlaşıp kıpırdamaz
- **Sabit odak** — afiş ızgarasında seçili satır hep aynı yerde durur, içerik onun
  altında kayar; ekrana tam iki satır sığar, sütun sayısı ekran genişliğine göre hesaplanır
- Listelerde kaydırma satır sınırına oturur (üstte yarım kesik satır kalmaz)
- Etkin kolon panelinin çerçevesi hafifçe vurgulanır
- Kategori içi arama kutusu kolon başlığının sağında durur (ayrı satır kaplamaz)
- Uzun seçim listelerinde (ör. altyazı sonuçları) "7 / 20" konum sayacı
- Oynatıcıda bildirimler sağ üstte çıkar; alt köşedeki "Intro'yu Atla" / "Sonraki bölüm"
  kartlarının üstüne binmez
- Giriş ve Altyazı Servisi ekranları iki sütunlu kart; 1080p ekrana tam sığar
- **Mouse/dokunmatik yok** — tamamen kumanda odaklı
- 1080p ve 4K'da aynı görünüm (tüm ölçüler `rem`, `html { font-size: 100vw/120 }`)
- Overscan güvenli alanı
- İsteğe bağlı **açılış görseli** (splash) — süresi Ayarlar'dan değiştirilir,
  herhangi bir tuşla atlanır

---

## Hızlı başlangıç

### Gereksinimler

| Gereksinim | Açıklama |
|---|---|
| Samsung TV | Tizen 9.0 (2025 modeller) hedeflenmiştir |
| Geliştirme bilgisayarı | Windows 10/11 (Tizen araçları için) |
| Tizen araçları | Tizen Studio + TV Extension **veya** VS Code Tizen eklentisi |
| Samsung hesabı | Ücretsiz; sertifika oluşturmak için gerekir |
| Ağ | PC ve TV **aynı yerel ağda** olmalı |

Sıfırdan, adım adım kurulum (Tizen Studio, Developer Mode, sertifika, TV'ye yükleme)
için: **[KURULUM.md](KURULUM.md)**

### Görsel dosyaları (repoda yok)

Uygulama simgesi ve açılış görseli depoya **dahil edilmemiştir.** Projeyi derlemeden önce
kendi görsellerinizi ekleyin:

| Dosya | Boyut | Zorunlu mu? | Eksikse ne olur? |
|---|---|---|---|
| `icon.png` | 512×512 PNG | **Evet** — `config.xml` kullanır | Paket derlenmez veya TV'de varsayılan simge görünür |
| `assets/icon.png` | 128×128 PNG | Hayır | Giriş ekranında ▶ logosu gösterilir |
| `assets/splash.jpg` | 1920×1080 JPEG | Hayır | Açılış görseli atlanır, uygulama doğrudan açılır |

### Önce bilgisayarda deneyin (TV gerekmez)

```cmd
python -m http.server 8080
```

Ardından Chrome'da `http://localhost:8080` adresini açın. `webapis.avplay` bulunmadığı
için uygulama otomatik olarak HTML5 `<video>` moduna geçer.

- **Klavye eşlemesi:** ok tuşları = yön, **Enter** = OK, **Backspace** = RETURN
- Chrome MPEG-TS oynatamaz ve HLS'i yalnızca Safari destekler; bu yüzden **PC'de görüntü
  gelmemesi normaldir.** Liste, gezinme, arama, favoriler, ayarlar ve hata yönetimi
  eksiksiz test edilebilir.
- Klasörde dolu bir `hesaplar.txt` varsa tarayıcıda da hesap otomatik eklenir ve giriş
  ekranı atlanır. Giriş ekranını denemek için hesabı uygulama içinden silin
  (*Playlistlerim* → KIRMIZI); aynı tarayıcıda geri eklenmez.

### TV'ye kurulum (özet)

1. TV'de **Developer Mode**'u açın (Apps ekranında `1 2 3 4 5`) ve PC'nin IP'sini girin.
2. Sertifika oluşturun (Samsung sertifikası; TV'nin DUID'ine bağlı Distributor sertifikası).
3. TV'ye bağlanıp derleyin, imzalayın, yükleyin:

```cmd
sdb connect <TV_IP>:26101

tizen build-web -e tests -e _kaynak -e node_modules -e "*.md" -- .
tizen package -t wgt -s <SERTIFIKA_PROFILI> -- .buildResult
tizen install -n IPTVPlayer.wgt -- .buildResult -t <TV_IP>:26101
tizen run -p IptvPlyr01.IPTVPlayer -t <TV_IP>:26101
```

> `hesaplar.txt`'yi **hariç tutmayın** (`-e` listesine eklemeyin); hesabın her kurulumda
> otomatik gelmesi bu dosyanın pakette olmasına bağlıdır.

> **VS Code kullanıyorsanız:** Tizen eklentisinin `Tizen: Build Project` ve
> `Tizen: Run Project` komutları aynı işi yapar. Eklenti `tests/` ve `_kaynak/`
> klasörlerini kendiliğinden dışlamaz; `tizen_web_project.yaml` içindeki `excludes`
> listesine `tests/*` ve `_kaynak/*` ekleyin.

> **Yeniden kurulumda uygulama verisi silinir.** Hesabınızı korumak için
> [`hesaplar.txt`](#hesabınızı-her-buildde-yeniden-girmeyin-hesaplartxt) kullanın.
> Favoriler ve geçmiş için yeni sürümü yüklemeden önce **Ayarlar → USB'ye Yedekle**
> ile yedek alın, kurulumdan sonra **Ayarlar → Yedekten Geri Yükle** deyin.

### Hesabınızı her build'de yeniden girmeyin: `hesaplar.txt`

Uzun playlist linkini kumandayla yazmak yerine, bilgisayarda proje klasöründeki
`hesaplar.txt` dosyasına **bir kez** yapıştırın. Dosya her build'de pakete girer;
uygulama açılışta onu okur, kayıtlı olmayan hesabı ekler ve etkinleştirir. Giriş
ekranı hiç görünmeden ana ekran açılır.

```text
# Her satıra bir hesap; # ile başlayan satırlar açıklamadır
http://SERVER:PORT/get.php?username=USERNAME&password=PASSWORD&type=m3u_plus
Ev Hesabı | http://SERVER:PORT/get.php?username=USERNAME&password=PASSWORD
İş Hesabı | http://SERVER:PORT | USERNAME | PASSWORD
m3u | Liste | http://SERVER:PORT/liste.m3u8

# Altyazı servisi (isteğe bağlı) — kullanıcı adı/şifre ve dil zorunlu değil
opensubtitles | API_ANAHTARI | KULLANICI | SIFRE | dil=tr
```

- `get.php?username=...&password=...` linkleri otomatik olarak **Xtream Codes** hesabına
  çevrilir (filmler, diziler ve rehber daha iyi çalışır). Düz M3U istiyorsanız satırın
  başına `m3u |` yazın.
- `opensubtitles |` satırı OpenSubtitles API anahtarını (ve varsa hesabı) her kurulumda
  kaydeder; Ayarlar → Altyazı Servisi ekranına bir daha girmeniz gerekmez. `dil=` yazmazsanız
  Türkçe aranır.
- Dosya her açılışta okunur. Kayıtlı bir Xtream hesabının şifresini dosyada
  değiştirirseniz, sonraki açılışta kayıtlı hesap da güncellenir (kopya oluşmaz).
- Uygulama içinden sildiğiniz bir hesap aynı kurulumda geri eklenmez; yeni build kurulunca eklenir.
  Altyazı ayarını TV'den elle değiştirirseniz, dosyadaki satırı değiştirene kadar TV'deki
  ayar korunur. Satırı silmek kayıtlı ayarı silmez.
- Anlaşılamayan satırlar atlanır (günlüğe uyarı yazılır); diğer satırlar yine işlenir.
- Dosya şifrenizi içerir: `.gitignore`'dadır, ama **.wgt paketine girer** — paketi paylaşmayın.
- Dosya yoksa veya boşsa uygulama normal şekilde giriş ekranıyla açılır.

---

## Kullanım

1. **Giriş ekranında** playlist türünü seçin:
   - **Xtream Codes:** `http://SERVER:PORT`, kullanıcı adı, şifre
   - **M3U:** playlist adresi (+ isteğe bağlı XMLTV EPG adresi)

   Uzun linki kumandayla yazmak istemiyorsanız onu build almadan önce
   [`hesaplar.txt`](#hesabınızı-her-buildde-yeniden-girmeyin-hesaplartxt) dosyasına yazın;
   giriş ekranı hiç açılmaz.
2. Playlist kaydedilir; sonraki açılışlarda *Playlistlerim* ekranından seçersiniz.
3. Ana ekrandan Canlı TV, Filmler, Diziler, Favoriler, Son İzlenenler, Arama ve
   Ayarlar'a geçin.

> **Diziler yalnızca Xtream Codes** kaynaklarında tam çalışır. M3U'da sezon/bölüm
> yapısı yoktur; uygulama bunu otomatik tespit etmeye çalışır ve kullanıcıya açıkça söyler.

---

## Kumanda tuşları

### Genel

| Tuş | İşlev |
|---|---|
| ◀ ▶ ▲ ▼ | Gezinme |
| OK / Enter | Seç / aç |
| RETURN (Back) | Geri |
| EXIT | Çıkış onayı |

**GERİ tuşu davranışı:**

```
oynatıcı  →  liste  →  ana menü  →  "Çıkılsın mı?" onayı  →  çıkış
```

Ekran içi durumlar da önce geri alınır: oynatıcıda bilgi şeridi açıksa önce o kapanır,
Canlı TV'de kanal kolonundaysanız önce kategori kolonuna dönülür, dizi detayında bölüm
listesindeyseniz önce sezon satırına dönülür, metin düzenlenirken TV klavyesi kapanır.

### Canlı TV

| Tuş | İşlev |
|---|---|
| SARI | Favorilere ekle / çıkar |
| MAVİ | Favori kategorisine atla |
| KIRMIZI | Kanal listesini yenile |
| 0–9 | Kanal numarasıyla hızlı geçiş |
| CH+ / CH− | Sayfa atlama |
| ▲ (listenin başında) | Başlıktaki kategori içi arama kutusuna geç |

### Oynatıcı

| Tuş | İşlev |
|---|---|
| OK | Sırasıyla: **sonraki bölüm** → **intro'yu atla** → **durdur / devam** |
| INFO | Bilgi şeridini aç/kapat |
| ▲ ▼ / CH+ CH− | Kanal değiştir (canlı) |
| ◀ ▶ | Geri / ileri sar — art arda bastıkça hızlanır |
| ⏪ ⏩ | 1 dk geri / ileri — art arda basınca birikir, tek sarma yapılır |
| PLAY / PAUSE | Duraklat / devam (canlı yayında desteklenmiyorsa ekranda belirtilir) |
| KIRMIZI | Favori |
| YEŞİL | Ses parçası seç |
| SARI | Altyazı seç |
| MAVİ | Yayını yeniden başlat (donma durumunda; film/bölüm kaldığı yerden devam eder) |
| 0–9 | Kanal numarası |

### Diğer ekranlar

| Ekran | Tuş | İşlev |
|---|---|---|
| Ana ekran | KIRMIZI | İçeriği yenile |
| Ana ekran | SARI | Arama |
| Filmler / Diziler | OK | Film detayı ve oynatma seçenekleri / dizinin sezon ve bölümleri |
| Filmler / Diziler | SARI | Favorilere ekle / çıkar |
| Filmler / Diziler | ▲ (ızgaranın başında) | Başlıktaki kategori içi arama kutusuna geç |
| Dizi detayı | CH+ / CH− | Önceki / sonraki sezon |
| Dizi detayı | SARI | Bölümü favorilere ekle / çıkar |
| Favoriler | SARI | Favorilerden çıkar |
| Favoriler | MAVİ | Tüm favorileri temizle |
| Son İzlenenler | SARI | Kayıttan sil |
| Son İzlenenler | MAVİ | Geçmişi temizle |
| Playlistlerim | YEŞİL | Yeni playlist ekle |
| Playlistlerim | SARI | Düzenle |
| Playlistlerim | KIRMIZI | Sil |
| Arama (sonuç listesinde) | SARI | Favorilere ekle / çıkar |
| Giriş | KIRMIZI / YEŞİL | Xtream Codes / M3U sekmesine geç |

---

## Mimari

```
        views/*  (ekranlar — yalnızca sunum ve kumanda)
           │
           ▼
    services/content.js   ◄── CEPHE (facade)
           │
     ┌─────┴─────┐
     ▼           ▼
 xtream.js    m3u.js  ──►  epg.js
     │           │
     ▼           ▼
  core/http.js  core/cache.js  core/storage.js
     │
     ▼
 player/controller.js ──► avplay.js  |  html5.js
```

**Kural:** Her katman yalnızca **altındakini** tanır. `views/` içinde hiçbir yerde
`App.Xtream` doğrudan çağrılmaz; hepsi `App.Content` üzerinden geçer. Yeni bir kaynak
türü eklemek için yalnızca `content.js` genişletilir.

**Açılış sırası:** `js/app.js` önce `services/presets.js` ile `hesaplar.txt`'yi okur
(hesapları `services/profile.js`'e, altyazı ayarını `services/opensubtitles.js`'e yazar),
ardından aktif hesap varsa ana ekranı, yoksa giriş ekranını açar.

**Oynatıcı katmanı:** `player/controller.js` tüm sarmaları tek noktadan yönetir
(`engineSeek`) ve sarma sürerken AVPlay'den gelen eski konumları yok sayar.
`player/avplay.js`, AVPlay'in asenkron işlemleri (`prepareAsync`, `seekTo`) sürerken
başka çağrı yapılmamasını garanti eden kilidi tutar: o sırada gelen duraklat/devam,
parça seçimi ve görüntü ayarı işlem bitince uygulanır.

### Klasör yapısı

```
iptv-app/
├── config.xml                 Tizen manifest: privilege, CSP, ayarlar
├── tizen_web_project.yaml     VS Code Tizen eklentisi proje ayarları
├── index.html                 Tek sayfa; script yükleme sırası burada
├── icon.png                   Uygulama simgesi (repoda yok, bkz. yukarıda)
├── hesaplar.txt               Kişisel hesap linkleri + altyazı anahtarı; her build'e girer (repoda yok)
├── README.md                  Bu belgenin İngilizcesi
├── README.tr.md               Bu belge (Türkçe)
├── KURULUM.md                 Tizen Studio + TV'ye kurulum kılavuzu
│
├── css/
│   ├── theme.css              Renk/ölçü token'ları, tipografi, güvenli alan
│   ├── reset.css              TV için sadeleştirilmiş reset (cursor:none)
│   ├── layout.css             Uygulama iskeleti, 3 kolon düzeni, topbar
│   ├── components.css         Buton, alan, liste, poster, modal, toast
│   └── views.css              Ekrana özel düzenler
│
├── js/
│   ├── app.js                 Başlatıcı: tuş yönlendirici, yaşam döngüsü
│   ├── core/
│   │   ├── polyfill.js        Eski Tizen tarayıcıları için ES5/ES6 eksikleri
│   │   ├── utils.js           DOM, metin, tarih, URL, parçalı döngü yardımcıları
│   │   ├── logger.js          Etiketli günlük + seviye kontrolü
│   │   ├── errors.js          App.AppError — tipli hata + Türkçe mesaj
│   │   ├── events.js          Global olay veriyolu (App.Bus)
│   │   ├── storage.js         localStorage sarmalayıcı + şifre gizleme
│   │   ├── settings.js        Kullanıcı tercihleri
│   │   ├── cache.js           İki katmanlı (bellek + disk) TTL'li önbellek
│   │   ├── bigstore.js        IndexedDB büyük veri deposu (playlist blob)
│   │   ├── http.js            XHR istemcisi: timeout, retry, tipli hatalar
│   │   ├── keys.js            Samsung kumanda tuş kodları + registerKey()
│   │   ├── nav.js             Geometrik odak yönetimi (spatial navigation)
│   │   ├── router.js          Ekran yığını + GERİ tuşu davranışı
│   │   └── actions.js         Ortak "içerik açma" mantığı
│   └── ui/
│       ├── loading.js         Tam ekran yükleniyor göstergesi
│       ├── toast.js           Kısa bildirimler
│       ├── modal.js           Onay / uyarı / seçim pencereleri
│       ├── field.js           TV klavyesi (IME) ile metin girişi
│       ├── imageLoader.js     Kuyruklu, sınırlı eşzamanlı logo/afiş yükleyici
│       ├── virtualList.js     Sanal liste/ızgara — performansın kalbi
│       └── qrcode.js          Saf ES5 QR kodlayıcı (harici bağımlılık yok)
│
├── services/
│   ├── profile.js             Kayıtlı playlistler + aktif hesap
│   ├── xtream.js              Xtream Codes API istemcisi + URL üretimi
│   ├── m3u.js                 M3U/M3U8 çözümleyici (parçalı, UI'yi kilitlemez)
│   ├── epg.js                 Xtream short_epg + XMLTV akış çözümleyici
│   ├── content.js             CEPHE: view'lar kaynak türünü bilmez
│   ├── favorites.js           Favoriler
│   ├── history.js             Son izlenenler + kaldığı yer
│   ├── backup.js              USB/dahili depolamaya yedekle & geri yükle
│   ├── presets.js             hesaplar.txt: hesapları ve altyazı servisini açılışta kurar
│   ├── subtitles.js           SRT/VTT çözümleyici + zaman çizelgesi
│   └── opensubtitles.js       OpenSubtitles REST API istemcisi
│
├── player/
│   ├── avplay.js              webapis.avplay sarmalayıcısı
│   ├── html5.js               PC tarayıcısı için <video> yedeği
│   └── controller.js          Oturum yönetimi: kurtarma, zapping, konum kaydı
│
├── views/                     login, playlists, home, live, movies, series,
│                              seriesDetail, favorites, recent, search, settings,
│                              opensubtitles, player
│
├── assets/                    icon.png, splash.jpg (repoda yok, bkz. yukarıda)
└── tests/                     jsdom tabanlı otomatik testler
```

### Neden ES5?

Kod bilerek **ES5** sözdizimindedir (`var`, `function`; template literal, `class`,
`async/await` yok). Sebep Tizen sürümleri arasındaki motor farkıdır:

| Tizen | Yıl | Tarayıcı motoru |
|---|---|---|
| 2.3 | 2015 modeller | Chromium 34 |
| 2.4 | 2016 modeller | Chromium 47 — `async/await` ve destructuring yok |
| 9.0 | 2025 modeller | Modern Chromium |

ES5 yazmak hiçbir şey kaybettirmez, ama uygulamanın eski ve yeni Samsung TV'lerde
çalışma ihtimalini artırır. `Promise` kullanılır (Tizen 2.3+ destekler) ve güvenlik
ağı olarak küçük bir polyfill bulunur.

---

## Performans tasarımı

Bir IPTV playlistinde 10.000+ kanal olabilir. Naif bir uygulama bunu TV'de 20 saniye
donmayla açar. Bu projede şu önlemler alınmıştır:

**1. Sanal liste** (`js/ui/virtualList.js`) — Ekranda görünen satır kadar (+ tampon) DOM
öğesi oluşturulur ve kaydırırken **yeniden kullanılır.** Kaydırma `scrollTop` yerine
`transform: translateY()` ile yapılır (GPU hızlandırmalı, reflow yok).

> Ölçüm (jsdom, 20.000 öğe): **15 DOM düğümü, 15 render, 2 ms**

**2. TTL'li önbellek + kompakt M3U kodlaması** (`js/core/cache.js`, `services/m3u.js`) —
Kategoriler 6 saat, kanal listeleri 30 dakika, EPG 2 dakika, çözümlenmiş M3U playlisti
1 hafta önbelleklenir. Her öğe bir diziye, kategori adı bir indekse çevrilir; adres ve
logo alanlarının **ortak ön eki bir kez** saklanır (gerçek bir Xtream M3U'sunda 20.000
kanalın tamamı aynı 77 karakterlik önekle başlar).

> Ölçüm (5.000 kanallık gerçekçi playlist): **1.985 KB → 298 KB (%15)**, yaklaşık 6,7 kat küçülme

**3. IndexedDB depolama** (`js/core/bigstore.js`) — Samsung TV'de `localStorage` kotası
~5 MB'tır ve tüm uygulama verisi bu alanı paylaşır. Büyük playlist sığmayınca yazma
sessizce başarısız oluyor ve liste her açılışta yeniden indiriliyordu. Playlist bloğu
artık IndexedDB'ye yazılır; IndexedDB yoksa sessizce `localStorage`'a düşülür.

**4. Zorunlu senkron layout'un kaldırılması** — `U.rem()` her satır render'ında
`getComputedStyle()` çağırıyordu ve bu kaydırmada gözle görülür kasma yaratıyordu.
Değer artık önbelleklenir. Liste satırları yeniden kurulmaz: DOM iskeleti havuz öğesi
başına bir kez kurulur, kaydırırken yalnızca metin/görsel güncellenir (`create` + `update`).
Odak halkası `box-shadow` animasyonu yerine anında belirir.

**5. Parçalı çözümleme** (`U.chunked`) — 100.000 satırlık M3U ve 50 MB'lık XMLTV
dosyaları 2.000'lik parçalar halinde, her parça arasında `setTimeout(0)` ile işlenir.
Arayüz asla kilitlenmez, kullanıcı yüzde görür. XMLTV için **DOMParser kullanılmaz**
(50 MB XML'in DOM ağacı ~500 MB RAM ister); regex tabanlı akış çözümleme yapılır ve
yalnızca "şimdi −2 saat / +36 saat" penceresindeki programlar saklanır.

**6. Kaydırma biçimleri** (`js/ui/virtualList.js`) — Kısa satırlı listeler (kanal,
kategori) `edge` modunda kayar: odak kenara gelince kaydırılır, bir satırlık ön izleme
görünür alana sığacak kadarla sınırlıdır ve kaydırma satır sınırına oturur. Afiş
ızgaraları `anchor` modundadır: odaklı satır daima üstte durur. Liste yenilenirken
(`setItems(..., { keepScroll: true })`) kaydırma konumu korunur.

**7. Görünmeyen öğeye yazılmaz** — Oynatıcı her ~0,5 sn konum bildirir; bilgi şeridi
kapalıyken ilerleme çubuğu güncellenmez, şerit açılınca son değerle bir kez çizilir.
Altyazının yer değiştirmesi `transform` geçişiyle (GPU) yapılır.

> Kasmanın sebebi ES5 değildi. ES5 ile ES6 arasında çalışma zamanı hız farkı yoktur;
> ikisi de aynı JIT tarafından derlenir.

---

## Kullanılan Samsung / Tizen API'leri

| API | Nerede | Ne için |
|---|---|---|
| `webapis.avplay.open / prepareAsync / play` | `player/avplay.js` | Donanım video oynatma |
| `webapis.avplay.setDisplayRect` | `player/avplay.js` | Video düzleminin ekrandaki yeri |
| `webapis.avplay.setDisplayMethod` | `player/avplay.js` | En-boy oranı (letterbox / doldur) |
| `setStreamingProperty('SET_MODE_4K')` | `player/avplay.js` | 4K donanım yolu (2020+ modeller) |
| `setStreamingProperty('ADAPTIVE_INFO')` | `player/avplay.js` | HLS başlangıç bit hızı → hızlı kanal açılışı |
| `webapis.avplay.setBufferingParam` | `player/avplay.js` | Başlangıç (4 sn) ve sarma/takılma sonrası (5 sn) tampon; Samsung alt sınırı 4 sn |
| `webapis.avplay.setTimeoutForBuffering` | `player/avplay.js` | Tampon 10 sn'de dolmazsa oynatmaya devam et (sarmadan sonra uzun donuk ekran olmasın) |
| `webapis.avplay.seekTo` | `player/avplay.js` | Sarma. Asenkron ve kilitleyicidir: callback gelene kadar başka AVPlay çağrısı yapılmaz, istekler sıraya alınır |
| `getTotalTrackInfo` / `setSelectTrack` | `player/avplay.js` | Çoklu ses / altyazı seçimi |
| `getStreamingProperty('CURRENT_BANDWIDTH')` | `player/avplay.js` | Tanı bilgisi |
| `tizen.tvinputdevice.registerKey` | `js/core/keys.js` | Medya, kanal, renkli ve sayı tuşları |
| `tizen.tvinputdevice.getSupportedKeys` | `js/core/keys.js` | Firmware farklarını tespit |
| `tizen.application.getCurrentApplication().exit()` | `js/core/router.js` | Uygulamadan çıkış |
| `webapis.productinfo.getRealModel / getFirmware` | `views/settings.js` | Sistem bilgisi ekranı |
| `webapis.productinfo.isUdPanelSupported` | `views/settings.js` | 4K panel tespiti |
| `tizen.systeminfo.getCapability(platform.version)` | `views/settings.js` | Tizen sürümü |
| `tizen.filesystem.resolve / listStorages` | `services/backup.js` | USB / İndirilenler klasörüne yedek |
| `tizen.filesystem.openFile('wgt-package/…')` | `services/presets.js` | `hesaplar.txt` okunamazsa yedek okuma yolu (Tizen 5.0+) |

Her çağrı `try/catch` ve özellik algılama (feature detection) ile korunmuştur;
`SET_MODE_4K` gibi yeni özellikler eski firmware'de sessizce devre dışı kalır.

---

## Hata yönetimi

Tüm hatalar `App.AppError` tipine dönüştürülür; ham JavaScript hatası kullanıcıya
gösterilmez ve uygulama çökmez (`window.onerror` ve `unhandledrejection` yakalanır).

| Kod | Ne zaman | Kullanıcıya gösterilen |
|---|---|---|
| `NETWORK` | Bağlantı kurulamadı / sunucu kapalı | "Sunucuya bağlanılamadı…" |
| `TIMEOUT` | İstek zaman aşımı | "Sunucu zamanında yanıt vermedi…" |
| `AUTH` | 401/403 veya `auth=0` | "Kullanıcı adı veya şifre hatalı…" |
| `EXPIRED` | Hesap süresi dolmuş / banlı | "Hesabınızın süresi dolmuş…" |
| `PARSE` | JSON yerine HTML, bozuk M3U/XML | "Sunucudan gelen veri okunamadı…" |
| `EMPTY` | Playlist boş | "Gösterilecek içerik bulunamadı." |
| `PLAYER` | AVPlay hatası | AVPlay kodunun Türkçe karşılığı |
| `OFFLINE` | TV internete bağlı değil | "Televizyon internete bağlı değil…" |
| `STORAGE` | localStorage kotası doldu | "Cihaz depolama alanı dolu…" |

- **Ağ hatalarında otomatik yeniden deneme** (1 tekrar + 1,2 sn bekleme). `AUTH` ve
  `404` tekrarlanmaz.
- **Yayın açılmazsa** önce format değiştirilir (`.m3u8` ↔ `.ts`), sonra 2 kez yeniden
  denenir; ancak ondan sonra kullanıcıya hata gösterilir. Film/bölümde yeniden deneme
  **kalınan yerden** başlar.
- **Sarma yanıt vermezse** (bazı firmware'ler geçersiz konumda callback çağırmaz) kilit
  8 sn sonra kendiliğinden açılır; oynatıcı kilitli kalmaz.
- **Hızlı kanal değiştirmede** eski yayının geç gelen başarı/hata sonucu yok sayılır;
  yanlış kanal yeniden denenmez.
- **EPG bulunamaması hata sayılmaz** — sessizce boş geçilir, kanal yine açılır.
- **`hesaplar.txt` okunamazsa** veya satırları anlaşılamazsa uygulama normal açılır.

---

## İnternetten altyazı (OpenSubtitles)

Kaynaktaki altyazı bozuk, eksik veya **görüntü tabanlı** (DVB-SUB / PGS — AVPlay bunları
metin olarak vermez) olduğunda oynatıcıda **SARI** tuş → *İnternetten altyazı indir* ile
OpenSubtitles'tan altyazı çekilebilir.

**Gerekenler (kullanıcı tarafında):**

1. Ücretsiz [OpenSubtitles](https://www.opensubtitles.com) hesabı
2. Kendi **API anahtarınız** (Hesabım → *API Consumers* → *New Consumer*)
3. TV'de Ayarlar → **Altyazı Servisi** ekranına anahtar + kullanıcı adı + şifre — ya da
   her build'de yeniden girmemek için `hesaplar.txt` dosyasına
   `opensubtitles | API_ANAHTARI | KULLANICI | SIFRE` satırı
   (bkz. [hesaplar.txt](#hesabınızı-her-buildde-yeniden-girmeyin-hesaplartxt))

> **API anahtarı uygulamaya gömülü değildir.** Servisin kullanım şartları her uygulamanın
> kendi anahtarını kullanmasını gerektirir ve indirme kotası anahtarın sahibine yazılır.
> Bilgiler yalnızca televizyonda saklanır.

| Adım | Ayrıntı |
|---|---|
| Arama | Bölümlerde **dizi adı + sezon + bölüm**, filmlerde **ad + yıl**. `1080p`, `WEB-DL`, `x264` gibi etiketler temizlenerek isabet artırılır |
| Sıralama | Önce güvenilir yükleyiciler, makine çevirileri geriye; sonra indirme sayısı |
| İndirme | `POST /download` → geçici bağlantı → `.srt`. Kalan günlük hak ekranda gösterilir |
| Senkron | Gecikme ayarı ±3 sn. **Artı** değer altyazıyı geciktirir, **eksi** erkene alır |
| Yerel önbellek | İndirilen her altyazı cihazda (IndexedDB) saklanır; aynı bölüm tekrar açıldığında internete çıkılmaz ve günlük hak harcanmaz |
| Toplu indirme | *Bu sezonun tüm altyazılarını indir* — kayıtlı olanları atlar, kota bitince durur, RETURN ile iptal edilir |

**Kota hakkında:** OpenSubtitles günlük hakkı dosya başına sayılır; 20 bölüm 20 hak
harcar. Asıl kazanç yerel önbellektir: bir kez indirilen altyazı cihazda kalır.
Bozuk bir altyazı için SARI tuş → **Yeniden indir**, hepsini silmek için
Ayarlar → **Altyazı Önbelleğini Temizle**.

**Sınırlar:** Eşleşme dosya adına değil başlığa dayanır, bu yüzden her zaman kusursuz
senkron tutmayabilir (gecikme ayarı bunun için vardır). Canlı yayınlarda kullanılamaz.
Bölüm kaydında dizi adı yoksa arama yapılamaz ve uygulama bunu açıkça söyler.

---

## Veri saklama ve gizlilik

- Tüm veriler **yalnızca televizyonda** saklanır (`localStorage` ve IndexedDB).
- **Hiçbir veri dışarı gönderilmez.** Analytics, reklam, telemetri veya üçüncü taraf takip
  yoktur. Uygulamanın yaptığı tek ağ isteği, kullanıcının girdiği IPTV sunucusuna
  (ve isteğe bağlı olarak OpenSubtitles'a) yapılır.
- Şifre cihaza özgü bir anahtarla **XOR + Base64** ile gizlenerek saklanır (`x1:` öneki).
  **Bu şifreleme değildir**; amacı depolama dökümüne bakan birinin şifreyi çıplak gözle
  okumasını engellemektir. Tizen TV web uygulamaları için gerçek bir keystore API'si yoktur.
- **Yedek dosyası** (`iptv-player-yedek.json`) IPTV şifrelerinizi **düz metin** içerir.
  USB belleği başkalarıyla paylaşmayın.
- **`hesaplar.txt`** linkinizi, şifrenizi ve (yazdıysanız) OpenSubtitles anahtarınızı düz
  metin içerir ve `.wgt` paketine girer.
  Dosya `.gitignore`'dadır (repoya girmez); **.wgt paketini başkalarıyla paylaşmayın.**
- **Ayarlar → Uygulama Verilerini Sıfırla** ile her şey silinir.

---

## Testler

Proje `jsdom` ile otomatik test edilir; **gerçek TV gerekmez.**

```cmd
cd tests
npm init -y
npm install jsdom qrcode

node unit.test.js
node nav.test.js
node m3u.test.js
node qr.test.js
node subtitles.test.js
node e2e.test.js
```

```
tests/unit.test.js        56 kontrol   parser'lar, URL üretimi, sanal liste, hata tipleri, modal odağı
tests/nav.test.js         21 kontrol   kumanda yön tuşu navigasyonu (gerçek 1080p ölçüleriyle)
tests/m3u.test.js         43 kontrol   M3U dizi tespiti, grup sırası, kompakt önbellek, BigStore
tests/qr.test.js          15 kontrol   QR kodlayıcı — referans kütüphaneyle birebir matris
tests/subtitles.test.js   73 kontrol   SRT/VTT çözümleme, zaman çizelgesi, OpenSubtitles istemcisi
tests/e2e.test.js         62 kontrol   sahte Xtream sunucusuyla tüm ekranların gezilmesi
---------------------------------------------------------------------------------------------
                         270 kontrol
```

**Kapsam:** açılış → ana ekran → canlı TV (2.500 kanal) → EPG → kanal numarasıyla geçiş →
favori → oynatıcı → geri → filmler (600 afiş) → dizi → sezon/bölüm → favoriler → son
izlenenler → arama → ayarlar → kök RETURN'de çıkış onayı. Ayrıca M3U ve XMLTV çözümleme,
Xtream URL üretimi, şifre gizleme, Türkçe normalizasyon, 20.000 öğelik sanal liste ve
önbelleğin tekrar istek atmadığı doğrulanır.

**QR kodlayıcı:** `js/ui/qrcode.js` sıfırdan yazılmıştır (Tizen paketi çevrimdışı çalıştığı
için CDN kullanılamaz). Doğruluğu npm `qrcode` referans kütüphanesiyle modül modül
karşılaştırılarak sınanır: 1–13 arası sürümlerde, L ve M hata düzeltme seviyelerinde,
UTF-8 Türkçe metin dahil birebir aynı matris. Referans kütüphane yalnızca testlere dahildir,
uygulamaya girmez.

> `tests/` klasörünü `.wgt` paketine **dahil etmeyin** (bkz. [Hızlı başlangıç](#tvye-kurulum-özet)).

<details>
<summary><b>Geliştirme geçmişi: testlerde ve gerçek TV'de bulunup düzeltilen kusurlar</b></summary>

&nbsp;

| Kusur | Etki | Düzeltme |
|---|---|---|
| Yön tuşu navigasyonu hizalamayı değil merkez mesafesini önceliklendiriyordu | Giriş ekranında ▼ metin kutularını atlayıp doğrudan butona gidiyordu | `js/core/nav.js` — dikey harekette yatay kesişimi olan öğeler daima öncelikli |
| Oynatıcı ekranı `mount()` içinde yayın hazır olana kadar bekliyordu | Ölü bir kanalda kullanıcı ~30 sn RETURN'e basamıyordu | `views/player.js` — oynatma promise'i döndürülmüyor, durum olaylarla yönetiliyor |
| Alt ekrandan geri dönünce hiçbir öğe odaklı kalmıyordu | Kumandada hangi öğenin seçili olduğu görünmüyordu | `js/core/router.js` — `activate()` içinde odak kurtarma |
| "★ Favoriler" kategorisi listenin başındaydı | İlk açılışta kanal listesi boş görünüyordu | `views/live.js`, `movies.js`, `series.js` — Favoriler "Tüm Kanallar"ın ardına alındı |
| `#EXTGRP` yalnızca `#EXTINF`'ten sonra yazıldığında çalışıyordu | Bazı playlistlerde tüm gruplar "Diğer" oluyordu | `services/m3u.js` — yapışkan grup, her iki sıralama destekli |
| Hesap bitiş tarihi yalnızca ekran yeniden açılınca görünüyordu | Açılışta üst barda sadece kullanıcı adı vardı | `views/home.js` — `profile:userinfo` olayına abone |
| `U.rem()` her satırda `getComputedStyle()` çağırıyordu | Kaydırmada zorunlu senkron layout, gözle görülür kasma | `js/core/utils.js` — değer önbelleklenir |
| Liste satırları her kaydırmada sıfırdan kuruluyordu | Gereksiz DOM yaratma/silme | `virtualList.js` + view'lar — `create`/`update` iskelet deseni |
| Odak halkası dışa doğru `box-shadow` idi | `overflow:hidden` kırpıyordu, seçili öğe tam görünmüyordu | `css/*` — içe doğru (inset) halka |
| Boş listede yön tuşları genel navigasyona düşüyordu | Kategori seçiminde odak başka kolona kaçıyordu | `virtualList.js` — boş listede tuş yutulur |
| Kategori değişiminde liste boşaltılıp "Yükleniyor" gösteriliyordu | Titreme ve odak kaybı | `views/live.js` — eski içerik yerinde kalır |
| M3U bölümleri film sayılıyordu | Diziler Filmler'e karışıyor, "dizi yok" deniyordu | `services/m3u.js` — dizi/bölüm kalıp tespiti + gruplama |
| M3U grupları alfabetik sıralanıyordu | TR kategorileri en üstte görünmüyordu | `services/m3u.js` — playlist sırası korunur |
| Çözümlenmiş playlist kotayı aşıyordu | Her açılışta yeniden indirme + çözümleme | `services/m3u.js` — kompakt kodlama (%83 küçülme) |
| Yeniden kurulumda tüm veri siliniyordu | Kayıtlı playlistler her build'de gidiyordu | `services/backup.js` — USB/dahili depolamaya yedek |
| Ses/altyazı menüsünde seçili parça belli değildi | Hangisinin çaldığı görünmüyordu | `player/controller.js` + `views/player.js` — ✔ işareti |
| İleri sarma tek adımlıydı | Uzun içerikte çok fazla tuşa basmak gerekiyordu | `views/player.js` — hızlanan sarma + tek seek |
| Modal pencerelerde odak hiç görünmüyordu | Ses/altyazı/onay listelerinde seçili satır belli değildi | `css/components.css` — odak stili `[data-focusable]` şartına bağlıydı, modal öğeleri bu niteliği taşımıyor |
| Altyazı seçilse de ekranda görünmüyordu | AVPlay altyazıyı çizmez, metni olayla verir; uygulama çizmiyordu | `views/player.js` — `.subtitle` katmanı + `player:subtitle` dinleyicisi |
| Ses/altyazı seçimi her içerikte sıfırlanıyordu | Her bölümde yeniden seçmek gerekiyordu | `player/controller.js` — dil kodu kalıcı hatırlanır |
| OK tuşu duraklatmıyordu | Orta tuş yalnızca bilgi şeridini açıyordu | `views/player.js` — OK artık durdur/devam; bilgi şeridi INFO tuşunda |
| Bazı altyazılar hiç gelmiyordu | Görüntü tabanlı altyazıları AVPlay metin olarak vermez, sebep belli değildi | `views/player.js` — 12 sn içinde metin gelmezse açıklayıcı uyarı |
| Otomatik dil tercihi elle yapılan seçimi eziyordu | Seçimden 1 sn sonra geri değişebiliyordu | `player/controller.js` — `manualPick` koruması |
| Bölüm kayıtlarında dizi adı kayboluyordu | Favoriler/Son İzlenenler'den açılan bölümde başlık "Bölüm 1" görünüyor, altyazı araması bununla yapılıyordu | `services/favorites.js`, `history.js` — `seriesName`/`season`/`episodeNum` saklanıyor |
| Toplu indirmede indirme hatası döngüyü sessizce durduruyordu | "Yükleniyor" ekranda takılı kalıyordu | `views/player.js` — tek `.catch()` |
| Büyük playlist localStorage kotasına sığmıyordu | Her açılışta yeniden indirme | `js/core/bigstore.js` (IndexedDB) + `services/m3u.js` ön ek sıkıştırması |
| `seekTo` sürerken başka AVPlay çağrıları yapılıyordu (ikinci sarma, duraklatma, parça listesi) | İleri sarınca görüntü donuyordu | `player/avplay.js` — meşgul kilidi: istekler sıraya alınır, yalnızca son hedef uygulanır |
| Sarma, sürmekte olan sarmanın hedefinden değil eski konumdan hesaplanıyordu | ⏩ ileri yerine geri atlayabiliyordu | `player/controller.js` — `seekState`, sarma sırasında gelen eski konumlar yok sayılır |
| ⏪ ⏩ her basışta ayrı `seekTo` gönderiyordu | Ard arda basınca üst üste sarma, donma | `views/player.js` — ok tuşlarıyla aynı biriktirme + tek sarma |
| `setBufferingParam` 2 sn veriliyordu (Samsung alt sınırı 4 sn) | Sarma sonrası yeniden tamponlama bozuluyordu | `player/avplay.js` — 4 / 5 sn; `setTimeoutForBuffering` 20 → 10 sn |
| Kaldığı yerden devam sarması sürerken ses/altyazı listesi okunuyordu | Bölüm açılışında donma | `player/controller.js` — dil tercihi sarma bitince uygulanır |
| Hızlı kanal değişiminde eski yayının sonucu yenisini etkiliyordu | Yanlış kanal yeniden deneniyordu | `player/controller.js` — `streamGen` ile eski sonuçlar yok sayılır |
| Ağ hatası sonrası yeniden denemede VOD baştan başlıyordu | Film başa dönüyordu | `player/controller.js` — kalınan konumdan devam |
| Canlı yayında duraklatma reddedildiği halde durum "duraklatıldı" yapılıyordu | Ekranda "Duraklatıldı" yazarken görüntü akıyordu | `player/controller.js` — motor sonucu kontrol ediliyor |
| Sanal listede ön izleme payı her zaman bir tam satırdı | Afiş ızgarasında seçili satır üstten kesiliyor, liste geri kayıyordu | `virtualList.js` — `anchor`/`edge` kaydırma, sınırlı pay, `posterGrid()` ile tam iki satır |
| Afiş odak halkası `inset box-shadow` idi | Resmin arkasında kalıyor, seçili afiş görünmüyordu | `css/components.css` — `::after` katmanı resmin üstünde |
| `.modal__list` konumlandırılmamıştı (`offsetTop` yanlış referans) | Altyazı listesinde aşağı inince liste yukarı fırlıyordu | `css/components.css` + `js/ui/modal.js` |
| Altyazının `bottom` değeri bilgi şeridiyle aniden değişiyordu | Altyazı yukarı zıplıyordu | `css/views.css` — `transform` geçişi |
| `.list` kuralı `.col__body` konumunu eziyordu | Kolon başlıkları ilk satırın üstüne biniyordu | `css/components.css` — `.list` konum vermez |
| Ayarlar listesinin kapsayıcısı konumlandırılmamıştı | Satırlar sağ paneli kaplıyor, yazılar taşıyordu | `css/views.css` — `.settings__list { position: relative }` |
| Liste yenilenince kaydırma sıfırlanıp odak ortalanıyordu | Ayarlarda her OK'ta liste zıplıyordu | `virtualList.js` — `keepScroll` |
| Giriş kartı ~1200 px yüksekliğindeydi | 1080p ekranda üstü ve "Bağlan" butonu kesiliyordu | `views/login.js`, `opensubtitles.js` — iki sütunlu kart |
| Gövde ekranın dibine kadar iniyordu | İpucu çubuğu listelerin üstüne biniyordu | `css/layout.css` — gövde alt boşluğu |
| Canlı TV'de KIRMIZI tuşu tanımsız `afterChannels()` çağırıyordu | Yenileme hata veriyor, filtre yok sayılıyordu | `views/live.js` |
| Kayıtlı playlistler her build'de siliniyordu | Uzun linki her kurulumda kumandayla yazmak gerekiyordu | `services/presets.js` + `hesaplar.txt` |
| OpenSubtitles anahtarı her build'de siliniyordu | Altyazı servisini her kurulumda yeniden girmek gerekiyordu | `services/presets.js` — `opensubtitles \|` satırı |

</details>

---

## Bilinen sınırlar

- **Diziler yalnızca Xtream Codes** kaynaklarında tam çalışır; M3U'da sezon/bölüm yapısı yoktur.
- **DRM'li içerik desteklenmez.** Gerekirse `config.xml`'e
  `http://developer.samsung.com/privilege/drmplay` privilege'ı ve AVPlay'e DRM
  yapılandırması eklenmelidir.
- **Catch-up / arşiv oynatma yoktur.** Xtream API'sinden `tv_archive` bilgisi okunur ve
  veri modelinde tutulur, ancak arşiv oynatma arayüzü bu sürümde yoktur.
- PC tarayıcısında MPEG-TS/HLS oynatılamaz (bkz. [Hızlı başlangıç](#önce-bilgisayarda-deneyin-tv-gerekmez)).
- **Favoriler, izleme geçmişi ve ayarlar** yeniden kurulumda hâlâ silinir (`hesaplar.txt`
  yalnızca hesapları ve altyazı servisini kapsar). USB yedeği `tizen.filesystem.resolve()`
  kullanır; bu yöntem Tizen 5.0'dan beri kullanımdan kaldırılmış (deprecated) durumdadır ve
  yeni modellerde çalışmayabilir.
- **Canlı yayın duraklatılamaz** (zaman kaydırma yoktur); PLAY/PAUSE'a basıldığında bu
  ekranda belirtilir.

---

## Katkıda bulunma

Katkılar memnuniyetle karşılanır. Pull request açmadan önce:

- **ES5 sözdizimi kullanın** (`var`, `function`; `class`, template literal, `async/await` yok).
- **Katman kuralına uyun:** `views/` doğrudan `App.Xtream` / `App.M3U` çağırmaz, yalnızca `App.Content`.
- **Framework veya çalışma zamanı bağımlılığı eklemeyin.** Paket çevrimdışı çalışır.
- **Gerçek sunucu adresi, kullanıcı adı, şifre veya API anahtarı** koda, teste ya da
  örneklere koymayın; `http://SERVER:PORT` gibi yer tutucular kullanın.
- Her `webapis.*` / `tizen.*` çağrısını `try/catch` ve özellik algılamayla koruyun.
- Testleri çalıştırın (bkz. [Testler](#testler)); yeni davranış için test ekleyin.
- Görsel dosyalarını (`icon.png`, `assets/splash.jpg`), kişisel `hesaplar.txt`
  dosyanızı ve imzalama sertifikalarını (`*.p12`, `*.pwd`, `*.pri`) **commit etmeyin**
  (hepsi `.gitignore`'dadır).
- AVPlay'e yeni bir çağrı ekliyorsanız `player/avplay.js` içindeki kilitten geçirin
  (`_run`); `seekTo` / `prepareAsync` sürerken doğrudan AVPlay çağırmak görüntüyü dondurur.

Hata bildirirken TV modelini, Tizen sürümünü (Ayarlar → Sistem Bilgisi) ve mümkünse
`sdb dlog -v time | findstr /i "ConsoleMessage"` çıktısını ekleyin.

---

## Lisans

Bu proje [LICENSE](LICENSE) dosyasındaki koşullarla dağıtılır.
