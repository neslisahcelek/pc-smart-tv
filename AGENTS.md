# 🤖 AGENTS.md — Smart TV Launcher & iPhone Remote

Bu dosya, bu projede çalışacak tüm AI ajanları (Antigravity, Gemini vb.) için **bağlayıcı kuralları, korunması zorunlu ana özellikleri ve güvenlik talimatlarını** içerir. 

> [!IMPORTANT]
> **TEMEL PRENSİP:** Yeni bir özellik eklerken veya bir hatayı çözerken, kullanıcının mevcut çalışan özelliklerini BOZMAK kesinlikle kabul edilemez. Bir değişiklik yapmadan önce aşağıdaki altın kuralları ve sistem mimarisini eksiksiz okuyun.

---

## 🛑 1. ALTIN KURALLAR (ASLA BOZULMAMASI GEREKEN ÖZELLİKLER)

### 1.1. Kullanıcının Kendi Kişisel Chrome Profili Kuralı
* **ASLA ayrı bir Chrome profili (`--user-data-dir=...`) KULLANMAYIN.**
* Kullanıcının tüm Netflix, YouTube, dizi siteleri oturumları, kayıtlı şifreleri ve eklentileri kendi varsayılan Chrome profilindedir. Kullanıcı farklı bir profil açılmasını kesinlikle reddetmiştir.
* **ASLA Chrome süreçlerini zorla sonlandırmayın (`taskkill /f /im chrome.exe` veya `killGhostTvChrome` YASAKTIR).** Bu işlem kullanıcının açık sekmelerini kapatır ve `User Data\lockfile` kilit dosyası hasarına yol açar.
* **Windows Oturum / Tekil Profil Koruması (Process Singleton):**  
  Windows üzerinde kullanıcı Chrome kullanırken arka plandaki izole bir desktop oturumundan `spawn("chrome.exe", ...)` çağrıldığında Chrome `Lock file can not be created (0x20)` hatası vererek (Exit 21) çöker. Bu nedenle TV Chrome başlatılırken **Windows Görev Zamanlayıcı (`SmartTvLauncher-OpenTv`)** veya kullanıcının interaktif masaüstü (`WinSta0\Default`) kullanılmalıdır. Bu görev `desktopLauncher.ts` içinde otomatik yönetilir.

### 1.2. TV Arayüzü Otomatik Başlatma ve Kumanda Butonu Bütünlüğü
* **iPhone'da Kumanda Açılınca TV Başlatma Durumu (`AUTO_LAUNCH_TV`):**  
  Kullanıcının video/dizi izlerken kumandayı her açışında TV arayüzünün izlenen videoyu bölmemesi için `AUTO_LAUNCH_TV` varsayılan olarak `false` tutulur. Kullanıcı `AUTO_LAUNCH_TV=true` yapılandırdığında, Safari'den kumandaya girildiğinde TV bağlı değilse (`tvConnectedCount === 0`) otomatik açılır.
* **Kumandadan Butonla Başlatma:**  
  Kumanda üst barındaki **`🖥️`** butonuna veya TV bağlı değilken beliren başlatma butonuna tıklandığında, TV ekranı anında öne getirilmeli veya başlatılmalıdır (`LAUNCH_ANTIGRAVITY=true` yapılandırılmışsa buton metni `TV & Antigravity Aç` olur ve her ikisini başlatır; varsayılanda ise `TV'yi Aç` olur).
* **Odak (Focus) Hiyerarşisi:**  
  TV ekranı açılırken veya öne getirilirken Google Antigravity IDE penceresi TV'nin önüne GEÇMEMELİDİR. `ensureDesktopAppsRunning()` fonksiyonunda `focusAntigravity()` yalnızca `forceAntigravity: true` açıkça talep edildiğinde veya `LAUNCH_ANTIGRAVITY=true` yapılandırıldığında çalıştırılmalıdır; TV daima en üstte kalmalıdır. Ayrıca kumanda açıldığında kullanıcının arkada izlediği pencerelerin odağını çalmamak için `focusTvLauncher()` yalnızca `forceTv: true` açıkça talep edildiğinde (buton tıklandığında vb.) çağrılmalıdır.

### 1.3. Kablosuz Trackpad & Dizi Hızlı Kontrolleri
* **60fps Akıcı Mouse / Trackpad:**  
  iPhone kumandasındaki touchpad alanı; piksel hedefleme, ivmelenme, tek parmak sol tık, iki parmak sağ tık, uzun basma sağ tık, çift tık ve basılı tutup sürükleme (pencere taşıma/seçim) özelliklerine sahiptir. Bu hareketlerin koordinat hesaplamaları ve Windows `mouse_event` API çağrıları bozulmamalıdır.
* **Çift Modlu Scroll:**  
  İki parmakla kaydırma ve sağ kenardaki özel dokunmatik kaydırma şeridi (thumb scroll strip) daima pürüzsüz çalışmalıdır.
* **Dizi & Medya Kontrolleri:**  
  `⏯ Oynat / Durdur` (Space & Media Play), `⏪ 10 sn Geri` (Left), `⏩ 10 sn İleri` (Right), `⛶ Tam Ekran` (F), `🔇 Sessiz` (M), `Sekme Değiştir` (Tab), `Geri Silme` (Backspace), `Enter` ve `Esc` tuş gönderimleri korunmalıdır.

### 1.4. Dizi Takip Sistemi (Progress Tracker)
* `data/progress.json` dosyasında dizi bölümleri (`season`, `episode`, `url`, `title`) saklanır.
* Kumandadaki **`+1 Sonraki Bölüm`** butonu bölüm numarasını güvenli şekilde artırmalı ve URL'deki bölüm bilgisini güncelleyebilmelidir.
* Chrome Uzantısı ile aktif sekmeden dizi kaydetme (`/api/progress/active-tab` ve `/api/progress`) uç noktaları çalışır durumda kalmalıdır.
* TVMaze üzerinden otomatik 16:9 dizi afişi / arka plan çözme mekanizması korunmalıdır.

### 1.5. YouTube & "Daha Sonra İzle" Çekmecesi
* **YouTube Data API v3:** Telefonda arama sonuçlarını listeleme, seçilen videoyu TV'de oynatma.
* **Kota Koruması:** Sunucu tarafında 15 dakikalık arama önbelleği ve dakikada maksimum 25 arama rate-limit koruması mevcuttur; API kotasını tüketmemek için bu koruma kaldırılmamalıdır.
* **Yedek Çözüm (Fallback):** API anahtarı girilmediğinde doğrudan YouTube linki yapıştırma ve TV tarayıcısında arama açma yedekleri çalışmalıdır.
* **Daha Sonra İzle Yönetimi:** Videoları `🗑 Kaldır` ile gizleme ve `Kaldırılanlar` çekmecesinden geri alma fonksiyonları korunmalıdır.

---

## 🔒 2. GÜVENLİK VE BİLGİ SIZINTISI ÖNLEME TALİMATLARI

### 2.1. API Anahtarları ve Kimlik Bilgileri (Zero Leakage)
1. **Frontend Koduna Asla Sır Yazmayın:**  
   `YOUTUBE_API_KEY`, `PROGRESS_TOKEN` veya herhangi bir parola/token `src/client/` dizini altındaki hiçbir dosyada yer alamaz.
2. **Sağlık (`/api/health`) ve Durum Payload'ları:**  
   Frontend'e gönderilen JSON yanıtlarında API anahtarlarının değerleri asla yer almamalıdır. Yalnızca `youtubeApiConfigured: boolean` gibi boolean varlık göstergeleri döndürülmelidir.
3. **`.env` Dosyası Koruması:**  
   `.env` dosyası kesinlikle `.gitignore` içinde kalmalıdır. Git commit'lerine veya herkese açık belgelere gerçek anahtarlar eklenemez. Örnek tanımlar için `.env.example` kullanılmalıdır.

### 2.2. Yerel Ağ (LAN) ve WebSocket Güvenliği
1. **RFC1918 ve Localhost Kısıtlaması:**  
   Sunucu sadece yerel ev ağından (`192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`) ve `localhost` / `127.0.0.1` / `::1` üzerinden gelen istekleri kabul etmelidir (`isPrivateLanIp` fonksiyonu).
2. **WebSocket Origin Doğrulaması:**  
   `wsHub.ts` içindeki `verifyClient`, dış sitelerden gelebilecek Cross-Site WebSocket hijacking saldırılarını önlemek için Origin başlığını katı bir şekilde denetler. İzinli olmayan origin'ler derhal `403 Forbidden` ile reddedilmelidir.
3. **Komut Şeması ve Boyut Sınırı:**  
   * WebSocket üzerinden gelen mesajlar için maksimum payload sınırı **16 KB**'tır.
   * `validateClientMessage` fonksiyonu gelen tüm komutları katı whitelist denetiminden geçirir. Tanımsız bir komut veya bozuk JSON geldiğinde sunucu çökmemeli, istemciye format hatası dönmelidir.
4. **Keyfi Komut ve Kod Çalıştırma Yasağı:**  
   Kumanda üzerinden veya HTTP parametreleriyle işletim sisteminde keyfi terminal/shell komutları çalıştırılmasına (`eval`, keyfi `exec`), keyfi dosya sistemine erişilmesine veya güvenli olmayan URL (`javascript:`, `file:`) açılmasına kesinlikle izin verilemez (`isSafeHttpsUrl` denetimi zorunludur).

---

## 🏗️ 3. SİSTEM MİMARİSİ VE DOSYA SORUMLULUKLARI

```
tv-controller/
├── src/
│   ├── client/                  # React + TypeScript Frontend
│   │   ├── tv/                  # 10-Foot TV Arayüzü (TVApp.tsx, YouTubePlayerView.tsx)
│   │   ├── remote/              # Mobil Kumanda (RemoteApp.tsx, TouchpadView.tsx)
│   │   ├── hooks/               # useWsClient.ts, useThemeScheme.ts
│   │   └── styles.css           # TV ve Kumanda stilleri (Dark/Light tema)
│   ├── server/                  # Node.js + Express + WebSocket Backend
│   │   ├── index.ts             # Express REST API, statik sunucu, auto-launch middleware
│   │   ├── wsHub.ts             # WebSocket Hub, durum yönetimi, komut yönlendirme
│   │   ├── desktopLauncher.ts   # Windows Chrome & Antigravity başlatıcı (schtasks & spawn)
│   │   ├── systemAudio.ts       # Windows CoreAudio COM ses kontrolü, fare & klavye simülasyonu
│   │   ├── progress.ts          # Dizi izleme durumu (JSON okuma/yazma/artırma)
│   │   ├── youtube.ts           # YouTube Data API v3 proxy ve önbellek
│   │   └── config.ts            # .env yükleme, IP tespiti, RFC1918 denetimi
│   ├── shared/                  # Paylaşılan Tipler ve Doğrulama
│   │   ├── protocol.ts          # Client/Server WebSocket mesaj tipleri ve validator
│   │   ├── types.ts             # TVState, ShortcutItem, ProgressEntry tanımları
│   │   └── shortcuts.ts         # Varsayılan platform ve dizi sitesi kısayolları
│   └── tests/                   # Vitest Birim ve Entegrasyon Testleri
├── scripts/                     # Windows Başlatma ve Servis Scriptleri
│   ├── start-tv-background.vbs  # Sessiz başlatıcı (Masaüstü kısayolunun hedefi)
│   ├── start-tv.bat             # Terminal üzerinden başlatıcı
│   ├── install-startup.bat      # Windows Başlangıç klasörüne kısayol ekleyici
│   └── uninstall-startup.bat    # Windows Başlangıç kısayolunu kaldırıcı
├── data/
│   └── progress.json            # Dizi izleme ilerleme verisi
└── extension/                   # Chrome Uzantısı (1-Tıkla Aktif Sekme Kaydetme)
```

---

## 📋 4. DEĞİŞİKLİK VE DOĞRULAMA KONTROL LİSTESİ (CHECKLIST)

Herhangi bir kod değişikliği yaptıktan sonra **MUTLAKA** şu adımları tamamlayın:

1. [ ] **Tip Kontrolü:** `npm run typecheck` hatasız tamamlanmalı.
2. [ ] **Birim ve Entegrasyon Testleri:** `npm test` çalıştırılmalı ve tüm testler (en az 27 test) firesiz geçmeli.
3. [ ] **Üretim Derlemesi:** `npm run build` ile hem istemci (`dist/client`) hem sunucu (`dist/server`) başarıyla derlenmeli.
4. [ ] **Kişisel Profil Güvencesi:** Kodda `--user-data-dir` veya `taskkill /im chrome.exe` bulunmadığından emin olunmalı.
5. [ ] **Kumanda Otomatik Başlatma Testi:** `/remote` ziyaret edildiğinde ve `🖥️` butonuna basıldığında TV ekranının tetiklendiği doğrulanmalı.
6. [ ] **Güvenlik Taraması:** Yeni bir gizli anahtar/token frontend koduna veya `.env` dışına sızdırılmamış olmalı.
