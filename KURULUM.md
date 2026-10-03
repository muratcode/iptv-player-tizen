# Samsung Smart TV'ye Kurulum Kılavuzu (Windows)

Bu kılavuz **hiç Tizen deneyimi olmayan** bir kullanıcı için, sıfırdan Tizen Studio
kurulumundan uygulamanın televizyona yüklenmesine kadar **hiçbir adım atlanmadan**
yazılmıştır.

**Hedef cihaz:** 2025 model Samsung TV (Tizen 9.0)
**Geliştirme bilgisayarı:** Windows 10/11 (64 bit)
**Toplam süre:** İlk kurulum ~45–60 dakika, sonraki yüklemeler ~1 dakika

---

## Bölüm 0 — Ön koşullar

| Gereksinim | Açıklama |
|---|---|
| Windows 10/11 64-bit | 8 GB RAM önerilir |
| Boş disk alanı | En az 10 GB |
| Java | Tizen Studio kendi JDK'sını getirir, ayrıca kurmanıza gerek yok |
| Ağ | **PC ve TV aynı ağda olmalı** (aynı modem/router). Kablolu bağlantı en güvenilirdir. |
| Samsung hesabı | Ücretsiz. Sertifika oluşturmak için zorunlu. |

> **Önemli:** PC ve TV'nin **aynı alt ağda** olması şart. Misafir ağı (Guest WiFi),
> VPN veya iki farklı router kullanıyorsanız bağlantı kurulamaz.

---

## Bölüm 1 — Samsung Developer hesabı oluşturma

1. Tarayıcıda **https://developer.samsung.com/smarttv** adresini açın.
2. Sağ üstten **Sign In** → **Create a Samsung Account** deyin.
   (Zaten Samsung hesabınız varsa — telefon/TV için — aynısını kullanabilirsiniz.)
3. E-posta, şifre, doğum tarihi girin ve e-postanızı doğrulayın.
4. Giriş yapın. Hesap ücretsizdir; hiçbir ödeme veya lisans gerekmez.

> Bu hesap yalnızca **sertifika imzalamak** için gerekir. Uygulamayı Samsung
> mağazasına yüklemeyeceğiz — sadece kendi TV'nize kuracağız.

---

## Bölüm 2 — Tizen Studio + TV Extension kurulumu

### 2.1 İndirme

1. **https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html**
   sayfasına gidin.
2. **Tizen Studio with IDE installer — Windows 64-bit** bağlantısını indirin.
   (Dosya adı örneği: `web-ide_Tizen_Studio_x.x_windows-64.exe`)

### 2.2 Kurulum

1. İndirdiğiniz `.exe` dosyasına **sağ tık → Yönetici olarak çalıştır**.
2. Lisansı kabul edin.
3. **Kurulum dizini** olarak **`C:\tizen-studio`** yazın.

   > ⚠️ **Türkçe karakter veya boşluk İÇEREN bir klasöre kurmayın.**
   > `C:\Users\Serenay\Masaüstü\...` gibi yollar Tizen araçlarını bozar.
   > `C:\tizen-studio` kullanın.

4. **Install** deyin ve bitmesini bekleyin (~10–15 dk).
5. Kurulum sonunda **Launch Package Manager** işaretli kalsın ve **Finish** deyin.

### 2.3 TV Extension paketini kurma (EN KRİTİK ADIM)

Tizen Studio varsayılan olarak **mobil** profille gelir. TV için ek paket gerekir.

1. Açılan **Tizen Package Manager** penceresinde **Main SDK** sekmesine gidin.
2. Şunların yüklü olduğundan emin olun (değilse **Install** basın):
   - `Tizen SDK tools`
   - `Web app. Filter` / `Web CLI`
3. **Extension SDK** sekmesine geçin.
4. Listede **Samsung Certificate Extension** → **Install**.
5. Listede **TV Extensions** başlığı altında **en yüksek sürümü** seçin
   (örn. `TV Extensions-9.0` veya `TV Extensions-8.0`) → **Install**.
6. Kurulum bitince Package Manager'ı kapatın.

**Doğrulama:** Komut istemi (cmd) açıp şunu yazın:

```
C:\tizen-studio\tools\ide\bin\tizen.bat version
```

Sürüm numarası yazıyorsa kurulum tamamdır.

### 2.4 PATH'e ekleme (isteğe bağlı ama önerilir)

Komutları her seferinde tam yol yazmadan kullanmak için:

1. Başlat → "ortam değişkenleri" ara → **Sistem ortam değişkenlerini düzenle**
2. **Ortam Değişkenleri…** → **Path** → **Düzenle** → **Yeni**
3. Şu iki satırı ekleyin:
   ```
   C:\tizen-studio\tools
   C:\tizen-studio\tools\ide\bin
   ```
4. Tamam → Tamam. **Açık olan tüm cmd pencerelerini kapatıp yeniden açın.**

Artık `tizen` ve `sdb` komutlarını doğrudan yazabilirsiniz.

---

## Bölüm 3 — Televizyonda Geliştirici Modunu (Developer Mode) açma

> Bu adımı **televizyonun kumandasıyla** yapacaksınız.

1. TV'yi açın, ana menüden **Apps** (Uygulamalar) ekranına girin.
2. Kumandadan sırayla **1 → 2 → 3 → 4 → 5** tuşlarına basın.
   - Kumandanızda sayı tuşu yoksa: kumandanın **123** tuşuna basıp ekranda çıkan
     sanal tuş takımını kullanın.
   - 2023+ modellerde bazı durumlarda **Apps** ekranında sağ üstteki **Ayarlar (⚙)**
     simgesine gidip yine 12345 dizisini girmeniz gerekebilir.
3. **Developer Mode** penceresi açılır.
4. **Developer mode: Off** → **On** yapın.
5. **Host PC IP** alanına **bilgisayarınızın yerel IP adresini** girin.

   Bilgisayarınızın IP'sini öğrenmek için cmd'de:
   ```
   ipconfig
   ```
   → **IPv4 Adresi** satırındaki değer (örn. `192.168.1.25`).

6. **OK** deyin.
7. **Televizyonu tamamen kapatıp açın** (fişten çekmeye gerek yok, kumandadan kapat–aç).

> Yeniden başlatmadan geliştirici modu etkinleşmez.

### TV'nin IP adresini öğrenme

Kumanda ile: **Ayarlar → Genel (veya Bağlantı) → Ağ → Ağ Durumu → IP Ayarları**
Buradaki **IP Adresi** değerini not edin (örn. `192.168.1.42`).

---

## Bölüm 4 — PC ile TV arasında bağlantı kurma

### 4.1 Device Manager ile (grafik arayüz)

1. **Başlat → Tizen Studio** açın (`C:\tizen-studio\ide\TizenStudio.exe`).
2. Menüden **Tools → Device Manager** açın.
3. Device Manager penceresinde sol üstteki **+ (Remote Device Manager)** simgesine basın.
4. **Add** deyin:
   - **Name:** `SamsungTV`
   - **IP:** TV'nin IP adresi (örn. `192.168.1.42`)
   - **Port:** `26101` (varsayılan, değiştirmeyin)
5. **Add** → listede cihaz görünür. Sağdaki **Connection** anahtarını **ON** yapın.
6. TV ekranında **"...bağlanmak istiyor, izin veriyor musunuz?"** uyarısı çıkarsa
   **Allow / İzin Ver** deyin.
7. Bağlantı kurulunca cihaz adının yanında yeşil bir işaret belirir.

### 4.2 Komut satırı ile (daha hızlı, önerilir)

```cmd
sdb connect 192.168.1.42:26101
sdb devices
```

Beklenen çıktı:
```
List of devices attached
192.168.1.42:26101     device     UE43CU7000
```

### Bağlanamıyorsanız

| Belirti | Çözüm |
|---|---|
| `failed to connect` | TV'yi kapatıp açın; Developer Mode'un **On** olduğunu doğrulayın |
| `device unauthorized` | TV ekranındaki izin penceresine **Allow** deyin |
| Hiç yanıt yok | PC ve TV **aynı ağda mı?** Misafir WiFi / VPN kapalı mı? |
| Güvenlik duvarı | Windows Defender Güvenlik Duvarı'nda `sdb.exe` için **Özel ağ** izni verin |
| Port kapalı | `telnet 192.168.1.42 26101` ile test edin |

---

## Bölüm 5 — Sertifika oluşturma (Author + Distributor)

Samsung TV'ye uygulama yüklemek için **imzalı** bir paket gerekir.
İki sertifika lazımdır:

- **Author Certificate** — sizi (geliştiriciyi) tanımlar
- **Distributor Certificate** — uygulamanın **hangi TV'lere** kurulabileceğini tanımlar
  (TV'nin **DUID** kimliğine bağlanır)

> ⚠️ **"Tizen" sertifikası değil, "Samsung" sertifikası seçmelisiniz.**
> Tizen sertifikası yalnızca emülatörde çalışır, gerçek TV'ye kurulum yapmaz.

### Adımlar

1. **TV'nin bağlı olduğundan emin olun** (Bölüm 4). Distributor sertifikası
   TV'nin DUID'ini otomatik okuyacak.
2. Tizen Studio → **Tools → Certificate Manager**.
3. İlk açılışta bir **şifre** ister — bu, sertifika deposunun şifresidir.
   Belirleyin ve **mutlaka not edin** (unutursanız sertifikaları yeniden üretmeniz gerekir).
4. Sol üstteki **+** işaretine basın.
5. **Samsung** seçin → **Next**.
6. **TV** seçin → **Next**.
7. **Create a new certificate profile** → Profil adı: `IPTVProfile` → **Next**.
8. **Author Certificate:**
   - **Create a new author certificate** seçin
   - **Author name:** adınız (örn. `Murat`)
   - **Password / Confirm password:** bir şifre belirleyin ve **not edin**
   - **Next**
9. Samsung hesabınıza **giriş** yapmanız istenir → e-posta ve şifrenizi girin → **Sign in**.
10. **Distributor Certificate:**
    - **Privilege level: Public** seçin (bu proje için yeterlidir)
    - **DUID** listesinde bağlı TV'niz **otomatik görünmelidir**.
      - Görünmüyorsa TV bağlı değildir → Bölüm 4'e dönün.
      - Manuel eklemek isterseniz DUID'i Device Manager'da cihaza sağ tıklayıp
        **DUID** seçeneğinden alabilirsiniz.
    - TV'nizin DUID'ini **işaretleyin** → **Next**
11. **Finish**. Profil `IPTVProfile` artık **aktif** olarak işaretlidir.

> **Not:** Sertifikalar ~2 yıl geçerlidir. Başka bir TV'ye kurmak isterseniz
> Certificate Manager'dan o TV'nin DUID'ini de Distributor sertifikasına eklemeniz gerekir.

---

## Bölüm 6 — Projeyi Tizen Studio'ya alma

### 6.1 Proje klasörü

Bu projenin dosyaları şu an burada:

```
C:\Users\Serenay\Desktop\iptv-app\
```

> ⚠️ Yol içinde **Türkçe karakter** varsa (`Masaüstü` gibi) sorun çıkabilir.
> Sorun yaşarsanız klasörü **`C:\projects\iptv-app`** altına kopyalayın ve
> oradan çalışın.

### 6.2 İçe aktarma

1. Tizen Studio → **File → Import…**
2. **Tizen → Tizen Project** → **Next**
3. **Select root directory** → **Browse** → `C:\Users\Serenay\Desktop\iptv-app` seçin
4. **Next** → **Next**
5. **Profile:** `tv-samsung`, **Version:** listedeki en yüksek sürüm
6. **Finish**

Proje sol paneldeki **Project Explorer**'da **IPTVPlayer** adıyla görünür.

---

## Bölüm 7 — Derleme (.wgt üretme) ve TV'ye yükleme

### Yöntem A — Tizen Studio arayüzü (en kolay)

1. **Project Explorer**'da projeye **sağ tık**
2. **Run As → Tizen Web Application**

Bu tek adım şunları yapar: derler → `IPTVPlayer.wgt` üretir → sertifikayla imzalar →
TV'ye yükler → TV'de otomatik başlatır.

Alt kısımdaki **Console** sekmesinde şunu görmelisiniz:
```
Installed the package: Id(IptvPlyr01.IPTVPlayer)
... successfully launched pid = ...
```

Sadece paket üretmek isterseniz: **sağ tık → Build Signed Package**
→ `.wgt` dosyası projenin altındaki **`.buildResult\`** klasöründe oluşur.

### Yöntem B — Komut satırı (tekrarlı yüklemeler için hızlı)

Komut istemini (cmd) açın:

```cmd
cd /d C:\Users\Serenay\Desktop\iptv-app

REM 1) Web kaynaklarını derle
REM    -e ile pakete GIRMEYECEK klasörleri dışlıyoruz:
REM       tests    -> otomatik testler
REM       _kaynak  -> görsellerin işlenmemiş ham hâlleri (birkaç MB)
REM                   Pakete giren sürümler: icon.png ve assets/splash.jpg
tizen build-web -e tests -e _kaynak -e node_modules -e "*.md" -- .

REM 2) İmzalı .wgt paketi üret  (-s <sertifika profili adı>)
tizen package -t wgt -s IPTVProfile -- .buildResult

REM 3) Bağlı TV'yi öğren
sdb devices

REM 4) TV'ye kur  (-t <sdb devices çıktısındaki cihaz adı>)
tizen install -n IPTVPlayer.wgt -- .buildResult -t 192.168.1.42:26101

REM 5) Uygulamayı başlat
tizen run -p IptvPlyr01.IPTVPlayer -t 192.168.1.42:26101
```

> `tizen run` çalışmazsa uygulamayı TV'de **Apps** ekranından elle açabilirsiniz.

### Yüklenen uygulamayı TV'de bulma

TV'de **Apps** (Uygulamalar) ekranına gidin. **IPTV Player** simgesi listenin
sonlarında görünür. Geliştirici modunda yüklenen uygulamalar genellikle
**"Developer Mode" / özel bir bölümde** listelenir.

---

## Bölüm 8 — Günlükleri (log) izleme ve hata ayıklama

### Konsol çıktısını görme

```cmd
sdb dlog -v time | findstr /i "ConsoleMessage"
```

Uygulamadaki tüm `console.log` satırları burada akar. Bizim uygulamamızda her satır
`[Modül]` etiketiyle başlar: `[Xtream]`, `[Player]`, `[Http]` gibi.

### Uzaktan hata ayıklama (Chrome DevTools)

```cmd
sdb shell 0 debug IptvPlyr01.IPTVPlayer
```

Çıktıda bir **port numarası** verir (örn. `port: 34567`). Sonra:

1. Chrome açın
2. Adres çubuğuna: `http://192.168.1.42:34567` yazın
3. Karşınıza tam DevTools çıkar: Elements, Console, Network, Performance

Bu, TV üzerinde çalışan uygulamayı canlı incelemenin en güçlü yoludur.

### Uygulamayı kaldırma

```cmd
tizen uninstall -p IptvPlyr01.IPTVPlayer -t 192.168.1.42:26101
```

---

## Bölüm 9 — Sık karşılaşılan hatalar ve çözümleri

| Hata mesajı | Sebep | Çözüm |
|---|---|---|
| `Author certificate not match` | TV'de aynı ID ile farklı sertifikayla imzalanmış eski sürüm var | Önce `tizen uninstall` ile kaldırın, sonra kurun |
| `Check the certificate` / `signature error` | Distributor sertifikasında bu TV'nin DUID'i yok | Certificate Manager → profili düzenleyip TV'nin DUID'ini ekleyin |
| `required_version is not supported` | `config.xml`'deki `required_version="8.0"` sizin TV Extension sürümünüzden yüksek | `config.xml`'de `required_version` değerini `7.0` veya `6.5` yapın. Kodda başka değişiklik gerekmez. |
| `Failed to connect to remote device` | Developer Mode kapalı / TV yeniden başlatılmadı / farklı ağ | Bölüm 3 ve 4'ü tekrar edin |
| Uygulama açılıyor ama **siyah ekran** | JS hatası | `sdb dlog` ile logu inceleyin |
| Kanallar yüklenmiyor, hep "Sunucuya bağlanılamadı" | `config.xml`'de `<access origin="*"/>` yok veya CSP engelliyor | `config.xml`'in tam halini kullandığınızdan emin olun |
| Görüntü gelmiyor, ses var | Video düzlemi sayfa arkasında kalıyor | Uygulamayı kapatıp açın; `body.player-active` sınıfı arka planı şeffaf yapar |
| `PLAYER_ERROR_RESOURCE_LIMIT` | TV'de başka bir uygulama video kaynağını tutuyor | Diğer uygulamaları kapatın, TV'yi yeniden başlatın |
| Kumandanın renkli/medya tuşları çalışmıyor | `tv.inputdevice` privilege'ı eksik | `config.xml`'deki privilege listesini kontrol edin |
| Uygulama bir süre sonra kendiliğinden kapanıyor | Developer Mode oturumu | TV'yi yeniden başlatıp Developer Mode'un hâlâ **On** olduğunu doğrulayın |

---

## Bölüm 10 — Bilgisayarda hızlı test (TV'ye kurmadan)

Arayüzü ve kumanda navigasyonunu TV'ye kurmadan denemek için:

```cmd
cd /d C:\Users\Serenay\Desktop\iptv-app
python -m http.server 8080
```

Sonra Chrome'da **http://localhost:8080** açın.

- `webapis.avplay` bulunmadığı için uygulama otomatik olarak **HTML5 `<video>`**
  moduna düşer ve bunu Ayarlar → Sistem Bilgisi'nde gösterir.
- **Klavye eşlemesi:** ok tuşları = yön tuşları, **Enter** = OK,
  **Backspace** = RETURN/Back.
- Chrome MPEG-TS oynatamaz ve HLS'i yalnızca Safari destekler; bu yüzden
  **PC'de görüntü gelmemesi normaldir.** Liste, navigasyon, arama, favoriler,
  ayarlar ve hata yönetimi tamamen test edilebilir.

---

## Bölüm 10.5 — ⚠️ Yeni sürüm yüklemeden ÖNCE yedek alın

Tizen bir `.wgt` paketini yeniden kurarken uygulamanın **tüm kayıtlı verisini
siler**: playlistler, favoriler, izleme geçmişi ve ayarlar.

Bu yüzden yeni bir build yüklemeden önce:

1. TV'ye bir **USB bellek** takın (en güvenilir yol; USB yoksa TV'nin
   *İndirilenler* klasörü kullanılır).
2. Uygulamada **Ayarlar → USB'ye Yedekle** deyin.
3. Yeni sürümü yükleyin.
4. **Ayarlar → Yedekten Geri Yükle** deyin.

Yedek dosyası `iptv-player-yedek.json` adıyla yazılır ve uygulama kaldırılsa
bile silinmez. Aynı dosyayı başka bir Samsung TV'ye takıp oraya da geri
yükleyebilirsiniz.

> ⚠️ Yedek dosyası IPTV şifrelerinizi **düz metin** içerir. USB belleği
> başkalarıyla paylaşmayın.

---

## Bölüm 11 — Güncelleme yayınlama

Kodda değişiklik yaptıktan sonra:

```cmd
cd /d C:\Users\Serenay\Desktop\iptv-app
tizen build-web -e tests -e _kaynak -e node_modules -e "*.md" -- .
tizen package -t wgt -s IPTVProfile -- .buildResult
tizen install -n IPTVPlayer.wgt -- .buildResult -t 192.168.1.42:26101
```

### Uygulama ikonunu değiştirmek

`icon.png` (proje kökü) — **512×512 PNG**. `config.xml` bu dosyayı kullanır.
Kare olmayan veya çok büyük bir görsel koymayın; TV'de bozuk görünür.
Köşelerin yuvarlak ve saydam olması ikonun uygulama listesinde düzgün
durmasını sağlar.

### İnternetten altyazı için OpenSubtitles anahtarı

Oynatıcıda SARI tuş → *İnternetten altyazı indir* özelliğini kullanmak için:

1. **https://www.opensubtitles.com** adresinde ücretsiz hesap açın.
2. Giriş yapın → **Hesabım** → **API Consumers** → **New Consumer**.
3. Bir isim verin (örn. `TV IPTV Player`); oluşan **API Key**'i kopyalayın.
4. TV'de **Ayarlar → Altyazı Servisi** ekranına API anahtarını, kullanıcı adınızı
   ve şifrenizi girin, **Kaydet ve Doğrula** deyin.

> Anahtar uygulamaya gömülü değildir: servisin şartları her uygulamanın kendi
> anahtarını kullanmasını gerektirir ve **indirme kotası sizin hesabınıza**
> yazılır. Ücretsiz kotada günlük indirme sınırlıdır.

### Açılış görselini değiştirmek

`assets/splash.jpg` dosyasını kendi görselinizle değiştirin (1920×1080 önerilir,
JPEG). Süreyi **Ayarlar → Açılış Görseli** bölümünden değiştirebilir veya
tamamen kapatabilirsiniz. Görsel ekrandayken herhangi bir tuşa basmak da geçer.

`config.xml` içindeki `version="1.0.0"` değerini her sürümde artırmanız önerilir
(`1.0.1`, `1.1.0` …). Aynı sürümle tekrar kurmak da çalışır.

**Her güncellemeden önce Bölüm 10.5'teki yedeği almayı unutmayın.**
