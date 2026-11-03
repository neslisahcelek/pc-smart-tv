# 📺 Smart TV Launcher & iPhone Kumanda

Smart TV özelliği olmayan veya eski televizyonları; HDMI ile bağlı bir Windows bilgisayar ve **iPhone Safari** üzerinden yönetilen modern bir Akıllı TV'ye dönüştüren, sıfır ek donanım maliyetli kablosuz kontrol sistemi.

---

## 🎯 Bu Proje Neye Çözüm Buluyor?

### ❌ Yaşanan Sorunlar:
1. **Akıllı TV Özelliği Olmayan veya Yavaşlayan Televizyonlar:** Smart TV özelliği bulunmayan, dahili işletim sistemi eskiyen veya destek kesildiği için uygulama açamayan televizyonlarda film/dizi izlemek için pahalı TV Box (Apple TV, TV Stick vb.) almak ya da bilgisayara mahkûm olmak gerekir.
2. **Koltuktan Kalkma ve Hantal Donanımlar:** Bilgisayarı TV'ye HDMI ile bağlayıp izlerken ses açmak, sonraki bölüme geçmek veya sekme değiştirmek için sürekli koltuktan kalkmak ya da salonda kaba kablosuz klavye/fare bulundurmak konforu bozar.
3. **Kişisel Oturumların ve Şifrelerin Kaybolması:** Mevcut Smart TV cihazları veya üçüncü parti medya merkezleri (Kodi vb.), kullanıcının Google Chrome'undaki kayıtlı oturumlarını (Netflix, Prime Video, YouTube, yerli/yabancı dizi siteleri üyelikleri, kayıtlı şifreler ve reklam engelleyiciler) kullanamaz; her platforma kumandayla tek tek şifre girmeyi gerektirir.
4. **Kullanışsız Mobil Uygulamalar:** Telefondan PC kontrolü sağlayan klasik uygulamalar App Store'dan kurulum ister, reklam barındırır, bağlantı kopmalarında zorluk çıkarır ve bilgisayarın ana sesini ya da TV arayüzünü entegre bir şekilde yönetemez.

### ✅ Bu Projenin Getirdiği Çözüm:
* **Her Televizyonu Eksiksiz Smart TV Yapar:** Ekstra TV Box veya donanım masrafı yapmadan, HDMI girişi olan herhangi bir standart televizyonu veya monitörü son derece hızlı bir Akıllı TV'ye dönüştürür.
* **Uygulama Yüklemeden iPhone ile Kontrol:** iPhone'a hiçbir uygulama yüklemeden, Safari ile aynı Wi-Fi üzerinden saniyeler içinde bağlanan şık bir kumanda ve 60 FPS akıcı touchpad sunar.
* **Kendi Chrome Profilinizi ve Şifrelerinizi Korur:** Ayrı veya boş bir profil açmaz; kişisel Chrome profilinizdeki tüm çerezleri, aktif oturumları, kayıtlı şifreleri ve eklentileri doğrudan TV ekranına taşır.
* **Otomatik Başlatma ve Entegre Ses:** Kumanda açıldığı anda TV arayüzü bilgisayarda otomatik olarak tam ekran açılır; Windows CoreAudio entegrasyonu sayesinde bilgisayarın ana ses seviyesi doğrudan kumandadan yönetilir.
* **Dizi & Medya Odaklı Deneyim:** Kaldığınız bölümleri afişleriyle takip eder, tek dokunuşla bir sonraki bölüme geçer ve video siteleri için özel klavye/mouse kısayolları sağlar.

---

## ✨ Temel Özellikler

### 🖥️ 1. 10-Foot TV Arayüzü (`/tv`)
* **Stageshow Bento Grid Mimarisi:** En son izlenen diziyi öne çıkaran 2x1 asimetrik Hero kartı (afiş, bölüm rozeti, ilerleme çubuğu ve tek tıkla izleme), Windows CoreAudio ses widget'ı ve YouTube çekmecesi.
* **Büyük Ekran Tasarımı & Akıllı Odak:** Uzaktan rahat okunan açık/koyu tema, geniş kartlar ve tam uzaktan kumanda / klavye navigasyonu (Spatial Navigation) ile odaklanan karta derinlik ve parlama efekti.
* **Platform & Dizi Kısayolları:** Netflix, YouTube, Prime Video, GAİN ve popüler dizi sitelerine anında erişim.
* **Kişiselleştirilebilir Düzen:** Kartların sırasını değiştirme, istenmeyenleri gizleme ve özel site kısayolları ekleme.
* **Hızlı Bağlantı:** iPhone ile anında eşleşme sağlayan ekrandaki yerel ağ QR kodu.

### 📱 2. iPhone Safari Kumandası (`/remote`)
* **D-Pad & Navigasyon:** Yön tuşları, Seç (Enter), Geri ve Ana Ekran kontrolleri.
* **Gerçek Windows Ses Kontrolü:** Windows CoreAudio COM entegrasyonu ile sistem sesini kaydırıcı (slider), butonlar veya sessize alma (mute) ile anlık kontrol etme.
* **Akıllı Uyandırma:** Kumanda açıldığında veya üstteki **`🖥️`** butonuna basıldığında bilgisayarda TV ekranını otomatik başlatma / öne getirme.

### 🖱️ 3. Kablosuz Trackpad & Hızlı Medya Tuşları
* **60 FPS Dokunmatik Mouse:** iPhone ekranını dizüstü touchpad'i gibi kullanarak imleci yönetme; tek parmak sol tık, iki parmak sağ tık, sürükle-bırak desteği.
* **Çift Modlu Scroll:** İki parmakla serbest kaydırma veya sağ kenardaki özel başparmak şeridiyle pürüzsüz sayfa kaydırma.
* **İnteraktif Dokunmatik Jest Rehberi:** Touchpad üzerindeki ✨ butonuna basarak tek parmak tık, çift parmak kaydırma, uzun basma ve sürükleme jestlerini canlı animasyonlarla gösteren rehber ve pratik test alanı.
* **Dizi & Video Kısayolları:** Tek dokunuşla `⏯ Oynat/Durdur` (Space/Media Key), `⏪ / ⏩ 10 sn Atlama`, `⛶ Tam Ekran` (F), `Sekme Değiştir` (Tab) ve `Esc`.

### 🍿 4. Dizi Takip Sistemi ("İzlemeye Devam Et")
* **Bölüm Hafızası:** Kaldığınız dizi bölümlerini `data/progress.json` dosyasında yerel olarak saklar.
* **Tek Dokunuşla Sonraki Bölüm (`+1`):** Kumandadan tek tıkla bölüm numarasını artırıp yeni bölüm linkini TV'de açma.
* **Otomatik Afişler:** TVMaze API üzerinden 16:9 yüksek kaliteli dizi afişlerini otomatik çeker.
* **Chrome Uzantısı:** Bilgisayarda izlediğiniz dizi sekmesindeyken uzantı simgesine tek tıklayarak bölümü TV ve kumanda listesine anında kaydetme (`extension/`).

### 📺 5. YouTube & "Daha Sonra İzle"
* **Telefonda Ara, TV'de Oynat:** Telefonda video arayıp seçilen videoyu TV'de başlatma.
* **Liste Yönetimi:** "Daha Sonra İzle" videolarını listeleme, izlenenleri listeden kaldırma ve geri alma.
* **Kısıtlı Video Desteği:** Gömülü oynatılması kısıtlı (Hata 101/150) videoları algılayıp doğrudan tam ekran YouTube sekmesinde açma seçeneği.
* **iOS Kestirmeler (Shortcuts):** Safari veya YouTube uygulamasından *"Paylaş -> TV'de Oynat"* desteği.

---

## 🚀 Kurulum ve Başlatma

### Gereksinimler
* Windows 10 veya 11
* Node.js 18+ ve Google Chrome

### Adım 1: Proje Bağımlılıklarını Yükleyin
```powershell
npm install
```

### Adım 2: Ortam Dosyasını Hazırlayın
`.env.example` dosyasını `.env` olarak kopyalayın:
```powershell
Copy-Item .env.example .env
```

`.env` dosyasındaki temel ayarlar:
```ini
PORT=3000
ALLOW_LAN=true
HOST=0.0.0.0

# İsteğe bağlı (YouTube arama ve oynatma listesi için):
YOUTUBE_API_KEY=
YOUTUBE_PLAYLIST_ID=

# İsteğe bağlı (Chrome uzantısı API güvenliği için token):
PROGRESS_TOKEN=
```
> [!NOTE]
> `YOUTUBE_API_KEY` girilmasa dahi doğrudan YouTube bağlantısı yapıştırarak TV'de oynatma özelliği çalışmaya devam eder.

### Adım 3: Üretim Sürümünü Derleyin
```powershell
npm run build
```

### Adım 4: Başlatın
İhtiyacınıza uygun başlatma yöntemini seçin:

* **Masaüstü Kısayolu ile (Önerilen):** `scripts/start-tv-background.vbs` dosyasını çalıştırın (veya Masaüstüne kısayolunu atın). Konsol penceresi açılmadan arka planda sessizce başlar.
* **Windows Başlangıcına Ekleme:** Bilgisayar her açıldığında otomatik başlaması için `scripts/install-startup.bat` dosyasını bir kez çalıştırın.
* **Terminalden Başlatma:**
  ```powershell
  npm start
  ```

---

## 📱 iPhone'dan Bağlanma Rehberi

1. Bilgisayarınızın yerel IP adresini öğrenin (örneğin `192.168.1.106`):
   ```powershell
   ipconfig | Select-String "IPv4"
   ```
2. iPhone'unuzun bilgisayarla **aynı Wi-Fi ağına** bağlı olduğundan emin olun.
3. iPhone Safari'den şu adresi açın:
   ```text
   http://<BILGISAYAR-IP-ADRESINIZ>:3000/remote
   ```
4. **💡 İpucu (Tam Ekran Uygulama Modu):** Safari'de alt kısımdaki **Paylaş** simgesine dokunup **"Ana Ekrana Ekle"** derseniz kumanda Safari adres çubuğu olmadan bağımsız bir mobil uygulama gibi tam ekran çalışır.

---

## 🔒 Güvenlik & Ağ İzolasyonu

* **Yalnızca Yerel Ağ (RFC1918):** Sunucu yalnızca yerel ev ağından gelen bağlantılara yanıt verir (`192.168.x.x`, `10.x.x.x`, `172.16-31.x.x` ve `localhost`). Dış internete kapalıdır.
* **Sıfır Sızıntı (Zero Leakage):** API anahtarları istemciye veya durum yanıtlarına asla iletilmez.
* **WebSocket Koruması:** Cross-Site WebSocket hijacking saldırılarına karşı katı Origin kontrolü ve 16 KB paket boyutu sınırı mevcuttur.

### Windows Güvenlik Duvarı İzni
iPhone'dan bağlanırken zaman aşımı hatası alıyorsanız, PowerShell'i **Yönetici Olarak** açıp yerel ağ için izin verin:
```powershell
New-NetFirewallRule -DisplayName "Smart TV Launcher (LAN TCP 3000)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -Profile Private
```

---

## 🧪 Test ve Kalite Kontrolü

### 🛡️ Pre-Push Code Review Ajanı (Önerilen)
Git deposuna kod göndermeden (`git push`) önce tüm güvenlik, profil koruma ve kalite standartlarını tek komutla denetleyin:
```powershell
npm run review
# veya
npm run pre-push
```

Bu kontrol otomatik olarak:
1. **Kişisel Chrome Profili Korumasını** (ayrı `--user-data-dir` veya `taskkill chrome.exe` yasağı),
2. **Güvenlik ve Bilgi Sızıntısını** (frontend kodunda sır/token olmaması, WebSocket origin ve 16 KB sınırları),
3. **Git Hijyenini** (çakışma işaretleri ve hassas dosya takibi),
4. **TypeScript Tip Denetimini** (`npm run typecheck`),
5. **Birim & Entegrasyon Testlerini** (`npm test`),
6. **Üretim Derlemesini** (`npm run build`) denetler.

#### Otomatik Git Pre-Push Kancası (Hook)
`git push` yaptığınızda bu incelemenin otomatik çalışması ve hatalı push'ları engellemesi için bir defaya mahsus kancayı kurun:
```powershell
npm run install-hooks
```

---

### Manuel Kontroller

Tüm birim ve entegrasyon testlerini çalıştırmak için:
```powershell
npm test
```

TypeScript tip denetimi için:
```powershell
npm run typecheck
```

---

## 🔧 Sorun Giderme

* **iPhone kumandaya bağlanamıyor:** Telefonunuzun mobil veride değil, bilgisayarla aynı Wi-Fi ağına bağlı olduğunu ve `ipconfig` ile IP adresinin doğruluğunu kontrol edin.
* **Kumandayı açınca TV ekranı açılmıyor:** Kumanda üst barındaki **`🖥️`** butonuna bir kez dokunun veya bilgisayarda `scripts/start-tv-background.vbs` betiğini çalıştırın.
* **Dizi sitelerine tıklandığında sekme açılmıyor:** Chrome'un `localhost` için açılır pencereleri engellemediğinden emin olun (Adres çubuğundaki kilit simgesi -> *Açılır pencereler ve yönlendirmeler: İzin Ver*).
* **YouTube "Gömülü olarak oynatılamıyor (Hata 101/150)" uyarısı:** Kumandada beliren *"YouTube Sekmesinde Aç"* butonuna basarak videoyu doğrudan YouTube sekmesinde başlatabilirsiniz.
