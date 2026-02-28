# CC-Viewer

Claude Code istek izleme sistemi; Claude Code'un tüm API isteklerini ve yanıtlarını gerçek zamanlı olarak yakalar ve görselleştirir (ham metin, hiçbir şey kırpılmaz). Geliştiricilerin Vibe Coding sürecinde bağlamlarını gözden geçirmelerine ve sorunları gidermelerine yardımcı olmak için tasarlanmıştır.

[English](../README.md) | [繁體中文](./README.zh-TW.md) | [简体中文](./README.zh.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | Türkçe | [Українська](./README.uk.md)

## Kullanım

### Kurulum

```bash
npm install -g cc-viewer
```

### Çalıştırma ve Otomatik Yapılandırma

```bash
ccv
```

Bu komut, yerel Claude Code kurulum yöntemini (NPM veya Native Install) otomatik olarak algılar ve buna göre uyum sağlar.

- **NPM Kurulumu**: Otomatik olarak Claude Code'un `cli.js` dosyasına bir yakalama betiği enjekte eder.
- **Native Install**: `claude` ikili dosyasını otomatik olarak algılar, yerel şeffaf bir proxy yapılandırır ve trafiği otomatik olarak yönlendirmek için Zsh Shell Hook ayarlar.

### Yapılandırma Geçersiz Kılma (Configuration Override)

Özel bir API uç noktası kullanmanız gerekiyorsa (örneğin kurumsal proxy), `~/.claude/settings.json` dosyasında yapılandırmanız veya `ANTHROPIC_BASE_URL` ortam değişkenini ayarlamanız yeterlidir. `ccv` bunu otomatik olarak tanır ve istekleri doğru şekilde iletir.

### Sessiz Mod (Silent Mode)

Varsayılan olarak, `ccv`, `claude`'u sararken sessiz modda çalışır; terminal çıktınızın temiz kalmasını ve yerel deneyimle tutarlı olmasını sağlar. Tüm günlükler arka planda yakalanır ve `http://localhost:7008` adresinden görüntülenebilir.

Yapılandırma tamamlandıktan sonra `claude` komutunu normal şekilde kullanın. İzleme arayüzünü görüntülemek için `http://localhost:7008` adresini ziyaret edin.

### Sorun Giderme (Troubleshooting)

Başlatma sorunuyla karşılaşırsanız, nihai bir sorun giderme yöntemi vardır:
Adım 1: Herhangi bir dizinde Claude Code'u açın;
Adım 2: Claude Code'a aşağıdaki talimatı verin:
```
cc-viewer npm paketini kurdum ancak ccv'yi çalıştırdıktan sonra hâlâ düzgün çalışmıyor. cc-viewer'ın cli.js ve findcc.js dosyalarını incele, belirli ortama göre yerel Claude Code dağıtım yöntemine uyum sağla. Uyum sağlarken değişiklik kapsamını mümkün olduğunca findcc.js ile sınırlı tut.
```
Claude Code'un hatayı kendisinin incelemesi, herhangi birine sormaktan veya herhangi bir belgeyi okumaktan çok daha etkilidir!

Yukarıdaki talimat tamamlandıktan sonra findcc.js güncellenecektir. Projeniz yerel dağıtım gerektiriyorsa veya fork edilmiş kodunuzda sık sık kurulum sorunlarını çözmeniz gerekiyorsa, bu dosyayı saklayın ve bir dahaki sefere doğrudan kopyalayın. Şu aşamada pek çok proje ve şirket Claude Code'u Mac'te değil, sunucu tarafında barındırarak kullanmaktadır; bu nedenle yazar, cc-viewer kaynak kodu güncellemelerinin takibini kolaylaştırmak amacıyla findcc.js dosyasını ayrı tutmuştur.

### Kaldırma

```bash
ccv --uninstall
```

### Sürümü Kontrol Etme

```bash
ccv --version
```

## Özellikler

### İstek İzleme (Ham Metin Modu)
<img width="1500" height="720" alt="image" src="https://github.com/user-attachments/assets/519dd496-68bd-4e76-84d7-2a3d14ae3f61" />
- Claude Code tarafından gönderilen tüm API isteklerini gerçek zamanlı olarak yakalar; kırpılmış günlükler değil, ham metin sağlar (bu çok önemlidir!!!)
- Main Agent ve Sub Agent isteklerini otomatik olarak tanır ve etiketler (alt türler: Bash, Task, Plan, General)
- MainAgent istekleri Body Diff JSON'u destekler; önceki MainAgent isteğiyle farkları daraltılmış şekilde gösterir (yalnızca değiştirilen/eklenen alanlar)
- Her istekte satır içi token kullanım istatistikleri (giriş/çıkış token, önbellek oluşturma/okuma, isabet oranı)
- Claude Code Router (CCR) ve diğer proxy senaryolarıyla uyumlu — API yol deseni eşleştirmesiyle istekleri yakalar

### Sohbet Modu

Main Agent'ın tam sohbet geçmişini bir sohbet arayüzüne dönüştürmek için sağ üst köşedeki "Sohbet Modu" düğmesine tıklayın:
<img width="1500" height="730" alt="image" src="https://github.com/user-attachments/assets/c973f142-748b-403f-b2b7-31a5d81e33e6" />


- Agent Team görüntüleme henüz desteklenmiyor
- Kullanıcı mesajları sağa hizalanır (mavi balon), Main Agent yanıtları sola hizalanır (koyu balon)
- `thinking` blokları varsayılan olarak daraltılır, Markdown olarak işlenir; düşünme sürecini görüntülemek için tıklayarak genişletin; tek tıkla çeviri desteklenir (özellik henüz kararlı değil)
- Kullanıcı seçim mesajları (AskUserQuestion) soru-cevap formatında gösterilir
- Çift yönlü mod senkronizasyonu: sohbet moduna geçildiğinde seçili isteğe karşılık gelen sohbete otomatik olarak gidilir; ham metin moduna geri dönüldüğünde seçili isteğe otomatik olarak gidilir
- Ayarlar paneli: araç sonuçları ve düşünme bloklarının varsayılan daraltma durumu değiştirilebilir


### İstatistik Araçları

Header alanındaki "Veri İstatistikleri" kayan paneli:
<img width="1500" height="729" alt="image" src="https://github.com/user-attachments/assets/b23f9a81-fc3d-4937-9700-e70d84e4e5ce" />

- Önbellek oluşturma/okuma sayısını ve önbellek isabet oranını gösterir
- Önbellek yeniden oluşturma istatistikleri: nedene göre gruplandırılmış (TTL, sistem/araçlar/model değişikliği, mesaj kesme/değiştirme, anahtar değişikliği) sayı ve cache_creation token'larını gösterir
- Araç kullanım istatistikleri: her aracın çağrı sıklığını çağrı sayısına göre sıralı olarak gösterir
- Skill kullanım istatistikleri: her Skill'in çağrı sıklığını çağrı sayısına göre sıralı olarak gösterir
- Kavram yardımı (?) simgesi: tıklandığında MainAgent, CacheRebuild ve çeşitli araçlar için yerleşik belgeleri görüntüler

### Günlük Yönetimi

Sol üst köşedeki CC-Viewer açılır menüsü aracılığıyla:
<img width="1200" height="672" alt="image" src="https://github.com/user-attachments/assets/8cf24f5b-9450-4790-b781-0cd074cd3b39" />

- Yerel günlükleri içe aktar: projeye göre gruplandırılmış geçmiş günlük dosyalarına göz at, yeni pencerede aç
- Yerel JSONL dosyası yükle: doğrudan yerel bir `.jsonl` dosyası seçerek görüntüle (500MB'a kadar desteklenir)
- Mevcut günlüğü farklı kaydet: mevcut izleme JSONL günlük dosyasını indir
- Günlükleri birleştir: birden fazla JSONL günlük dosyasını birleşik analiz için tek bir oturumda birleştir
- Kullanıcı Prompt'larını görüntüle: tüm kullanıcı girdilerini çıkar ve görüntüle, üç görüntüleme modunu destekler — Ham mod (orijinal içerik), Bağlam modu (sistem etiketleri daraltılabilir), Metin modu (düz metin); eğik çizgi komutları (`/model`, `/context` vb.) bağımsız girişler olarak gösterilir; komutla ilgili etiketler Prompt içeriğinden otomatik olarak gizlenir
- Prompt'ları TXT olarak dışa aktar: kullanıcı Prompt'larını (düz metin, sistem etiketleri hariç) yerel bir `.txt` dosyasına aktar

### Çoklu Dil Desteği

CC-Viewer 18 dili destekler ve sistem yerel ayarına göre otomatik olarak geçiş yapar:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

### Otomatik Güncelleme

CC-Viewer başlangıçta otomatik olarak güncellemeleri kontrol eder (en fazla 4 saatte bir). Aynı ana sürüm içinde (ör. 1.x.x → 1.y.z) güncellemeler otomatik olarak uygulanır ve bir sonraki yeniden başlatmada geçerli olur. Ana sürüm değişiklikleri yalnızca bir bildirim gösterir.

Otomatik güncelleme, Claude Code'un `~/.claude/settings.json` dosyasındaki genel yapılandırmasını takip eder. Claude Code otomatik güncellemeleri devre dışı bıraktıysa (`autoUpdates: false`), CC-Viewer de otomatik güncellemeleri atlayacaktır.

## License

MIT
