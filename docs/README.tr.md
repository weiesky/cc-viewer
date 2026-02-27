# CC-Viewer

Claude Code istek izleme sistemi, Claude Code'un tüm API isteklerini ve yanıtlarını gerçek zamanlı olarak yakalar ve görsel olarak sunar (ham metin, sansürsüz). Geliştiricilerin kendi Context'lerini izlemelerine olanak tanır, böylece Vibe Coding sürecinde sorunları gözden geçirip ayıklayabilirler.

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | Türkçe | [Українська](./README.uk.md)

## Kullanım

### Kurulum

```bash
npm install -g cc-viewer
```

### Çalıştırma ve Otomatik Yapılandırma

```bash
ccv
```

Bu komut, yerel Claude Code kurulum yönteminizi (NPM veya Native Install) otomatik olarak algılar ve buna göre uyum sağlar.

- **NPM Kurulumu**: Claude Code'un `cli.js` dosyasına otomatik olarak yakalama betiği enjekte eder.
- **Native Install**: `claude` ikili dosyasını otomatik olarak algılar, yerel bir şeffaf proxy yapılandırır ve trafiği otomatik olarak iletmek için bir Zsh Shell Hook ayarlar.

### Yapılandırma Geçersiz Kılma (Configuration Override)

Özel bir API uç noktası (örneğin kurumsal proxy) kullanmanız gerekiyorsa, bunu `~/.claude/settings.json` dosyasında yapılandırın veya `ANTHROPIC_BASE_URL` ortam değişkenini ayarlayın. `ccv` bunu otomatik olarak tanıyacak ve istekleri doğru şekilde iletecektir.

### Sessiz Mod (Silent Mode)

Varsayılan olarak `ccv`, `claude`'u sararken sessiz modda çalışır, bu da terminal çıktınızın temiz kalmasını ve orijinal deneyimle tutarlı olmasını sağlar. Tüm günlükler arka planda yakalanır ve `http://localhost:7008` adresinde görüntülenebilir.

Yapılandırma tamamlandıktan sonra `claude` komutunu normal şekilde kullanın. İzleme arayüzünü görüntülemek için `http://localhost:7008` adresini ziyaret edin.

### Sorun Giderme (Troubleshooting)

- **Karışık Çıktı (Mixed Output)**: `[CC-Viewer]` hata ayıklama günlüklerinin Claude çıktısıyla karıştığını görürseniz, en son sürüme güncelleyin (`npm install -g cc-viewer`).
- **Bağlantı Reddedildi (Connection Refused)**: `ccv` arka plan işleminin çalıştığından emin olun. `ccv` veya `claude` (Hook kurulumundan sonra) çalıştırmak onu otomatik olarak başlatmalıdır.
- **Boş Gövde (Empty Body)**: Viewer'da "No Body" görürseniz, bunun nedeni standart olmayan SSE formatları olabilir. Viewer artık yedek olarak ham içerik yakalamayı desteklemektedir.

### Kaldırma

```bash
ccv --uninstall
```

### Sürüm Kontrolü

```bash
ccv --version
```

## Özellikler

### İstek İzleme (Ham Metin Modu)
<img width="1500" height="720" alt="image" src="https://github.com/user-attachments/assets/519dd496-68bd-4e76-84d7-2a3d14ae3f61" />
- Claude Code'dan gelen tüm API isteklerini gerçek zamanlı olarak yakalar, ham metin olduğunu garanti eder, sansürlenmiş günlükler değil (bu çok önemli!!!)
- Main Agent ve Sub Agent isteklerini otomatik olarak tanımlar ve etiketler (alt türler: Bash, Task, Plan, General)
- MainAgent istekleri Body Diff JSON'u destekler, önceki MainAgent isteğiyle farkları katlanmış olarak gösterir (yalnızca değişen/eklenen alanlar)
- Her istek satır içi Token kullanım istatistiklerini gösterir (giriş/çıkış token'ları, önbellek oluşturma/okuma, isabet oranı)
- Claude Code Router (CCR) ve diğer proxy senaryolarıyla uyumlu — istekler yedek olarak API yol deseni ile eşleştirilir

### Sohbet Modu

Main Agent'ın tam konuşma geçmişini sohbet arayüzüne dönüştürmek için sağ üstteki "Sohbet Modu" düğmesine tıklayın:
<img width="1500" height="730" alt="image" src="https://github.com/user-attachments/assets/c973f142-748b-403f-b2b7-31a5d81e33e6" />


- Agent Team görüntüleme henüz desteklenmemektedir
- Kullanıcı mesajları sağa hizalı (mavi baloncuklar), Main Agent yanıtları sola hizalı (koyu baloncuklar)
- `thinking` blokları varsayılan olarak katlanmış, Markdown olarak işlenir, düşünce sürecini görmek için tıklayarak genişletin; tek tıkla çeviriyi destekler (özellik henüz kararsız)
- Kullanıcı seçim mesajları (AskUserQuestion) soru-cevap formatında gösterilir
- Çift yönlü mod senkronizasyonu: sohbet moduna geçildiğinde seçili isteğe karşılık gelen konuşmaya otomatik olarak gidilir; ham metin moduna geri dönüldüğünde seçili isteğe otomatik olarak gidilir
- Ayarlar paneli: araç sonuçları ve thinking bloklarının varsayılan katlanma durumunu değiştirebilirsiniz


### İstatistik Araçları

Başlık alanındaki "Veri İstatistikleri" açılır paneli:
<img width="1500" height="729" alt="image" src="https://github.com/user-attachments/assets/b23f9a81-fc3d-4937-9700-e70d84e4e5ce" />

- Cache creation/read sayılarını ve cache isabet oranını gösterir
- Cache yeniden oluşturma istatistikleri: nedene göre gruplandırılmış (TTL, system/tools/model değişikliği, mesaj kısaltma/değiştirme, key değişikliği) sayı ve cache_creation token'larını gösterir
- Araç kullanım istatistikleri: her aracın kullanım sıklığını çağrı sayısına göre sıralı gösterir
- Skill kullanım istatistikleri: her Skill'in kullanım sıklığını çağrı sayısına göre sıralı gösterir
- Kavram yardımı (?) simgesi: MainAgent, CacheRebuild ve çeşitli araçların yerleşik belgelerini görüntülemek için tıklayın

### Günlük Yönetimi

Sol üstteki CC-Viewer açılır menüsü aracılığıyla:
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

## License

MIT
