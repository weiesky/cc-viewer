# CC-Viewer

[![npm version](https://img.shields.io/npm/v/cc-viewer)](https://www.npmjs.com/package/cc-viewer)

Claude Code için tüm API isteklerini ve yanıtlarını gerçek zamanlı olarak yakalayan ve görselleştiren bir istek izleme sistemi. Geliştiricilerin Vibe Coding sırasında Context'i inceleme ve hata ayıklama amacıyla izlemelerine yardımcı olur.

[简体中文](./README.zh.md) | [English](../README.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Українська](./README.uk.md)

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

- **NPM Kurulumu**: Claude Code'un `cli.js` dosyasına otomatik olarak kesme komut dosyaları enjekte eder.
- **Native Install**: `claude` ikili dosyasını otomatik olarak algılar, yerel bir şeffaf proxy yapılandırır ve trafiği otomatik olarak iletmek için bir Zsh Shell Hook ayarlar.

### Yapılandırma Geçersiz Kılma (Configuration Override)

Özel bir API uç noktası (örneğin kurumsal proxy) kullanmanız gerekiyorsa, bunu `~/.claude/settings.json` dosyasında yapılandırın veya `ANTHROPIC_BASE_URL` ortam değişkenini ayarlayın. `ccv` bunu otomatik olarak tanıyacak ve istekleri doğru şekilde iletecektir.

### Sessiz Mod (Silent Mode)

Varsayılan olarak `ccv`, `claude`'u çalıştırırken sessiz modda çalışır, bu da terminal çıktınızın temiz kalmasını ve orijinal Claude Code deneyimiyle aynı olmasını sağlar. Tüm loglar arka planda yakalanır ve `http://localhost:7008` adresinde görüntülenebilir.

Yapılandırmadan sonra `claude` komutunu normal şekilde kullanın. İzleme arayüzünü görüntülemek için `http://localhost:7008` adresini ziyaret edin.

### Sorun Giderme (Troubleshooting)

- **Karışık Çıktı (Mixed Output)**: `[CC-Viewer]` hata ayıklama loglarının Claude çıktısıyla karıştığını görürseniz, lütfen en son sürüme güncelleyin (`npm install -g cc-viewer`).
- **Bağlantı Reddedildi (Connection Refused)**: `ccv` arka plan işleminin çalıştığından emin olun. `ccv` veya `claude` (hook kurulumundan sonra) çalıştırmak onu otomatik olarak başlatmalıdır.
- **Boş Gövde (Empty Body)**: Viewer'da "No Body" görürseniz, bunun nedeni standart olmayan SSE formatları olabilir. Viewer artık yedek olarak ham içerik yakalamayı desteklemektedir.

### Sürüm Kontrolü (Check Version)

```bash
ccv --version
```

### Kaldırma

```bash
ccv --uninstall
```

## Özellikler

### İstek İzleme (Raw Modu)

- Claude Code'dan gelen tüm API isteklerinin gerçek zamanlı yakalanması, streaming yanıtlar dahil
- Sol panel istek yöntemini, URL'yi, süreyi ve durum kodunu gösterir
- Main Agent ve Sub Agent isteklerini otomatik olarak tanımlar ve etiketler (alt türler: Bash, Task, Plan, General)
- İstek listesi seçilen öğeye otomatik olarak kaydırılır (mod değişikliğinde ortalanır, manuel tıklamada en yakına kaydırılır)
- Sağ panel Request / Response sekme geçişini destekler
- Request Body varsayılan olarak `messages`, `system`, `tools` öğelerini bir seviye genişletir
- Response Body varsayılan olarak tamamen genişletilir
- JSON görünümü ile düz metin görünümü arasında geçiş
- Tek tıkla JSON içeriği kopyalama
- MainAgent istekleri Body Diff JSON'u destekler, önceki MainAgent isteğiyle farkları katlanmış olarak gösterir (yalnızca değişen/eklenen alanlar)
- Diff bölümü JSON/Metin görünümü geçişini ve tek tıkla kopyalamayı destekler
- "Diff'i Genişlet" ayarı: etkinleştirildiğinde MainAgent istekleri diff bölümünü otomatik olarak genişletir
- Body Diff JSON araç ipucu kapatılabilir; kapatıldığında tercih sunucu tarafında kaydedilir ve bir daha gösterilmez
- Hassas başlıklar (`x-api-key`, `authorization`) kimlik bilgisi sızıntısını önlemek için JSONL log dosyalarında otomatik olarak maskelenir
- İstek başına satır içi Token kullanım istatistikleri (giriş/çıkış token'ları, önbellek oluşturma/okuma, isabet oranı)
- Claude Code Router (CCR) ve diğer proxy yapılandırmalarıyla uyumlu — istekler yedek olarak API yol deseni ile eşleştirilir

### Chat Modu

Main Agent'ın tam konuşma geçmişini sohbet arayüzüne dönüştürmek için sağ üstteki "Chat modu" düğmesine tıklayın:

- Kullanıcı mesajları sağa hizalı (mavi balonlar), Main Agent yanıtları sola hizalı (koyu balonlar) Markdown oluşturma desteğiyle
- `/compact` mesajları otomatik algılanır ve daraltılmış gösterilir, tam özeti genişletmek için tıklayın
- Araç çağrısı sonuçları ilgili Assistant mesajı içinde satır içi görüntülenir
- `thinking` blokları varsayılan olarak daraltılmış, Markdown olarak işlenmiş, genişletmek için tıklayın; tek tıkla çeviri desteği
- `tool_use` kompakt araç çağrısı kartları olarak gösterilir (Bash, Read, Edit, Write, Glob, Grep, Task her biri özel görünüme sahip)
- Task (SubAgent) araç sonuçları Markdown olarak işlenir
- Kullanıcı seçim mesajları (AskUserQuestion) soru-cevap formatında gösterilir
- Sistem etiketleri (`<system-reminder>`, `<project-reminder>`, vb.) otomatik daraltılır
- Skill yükleme mesajları otomatik algılanır ve daraltılır, Skill adı gösterilir; tam belgeleri genişletmek için tıklayın (Markdown oluşturma)
- Skills reminder otomatik algılanır ve daraltılır
- Sistem metni otomatik filtrelenir, yalnızca gerçek kullanıcı girişi gösterilir
- Çoklu session segmentli görüntüleme (`/compact`, `/clear` vb. sonrasında otomatik segmentleme)
- Her mesaj saniye hassasiyetinde zaman damgası gösterir, API istek zamanlamasından türetilmiş
- Her mesajda ilgili API isteğine raw modunda geri dönmek için bir "İsteği Görüntüle" bağlantısı bulunur
- Çift yönlü mod senkronizasyonu: sohbet moduna geçildiğinde seçili isteğe karşılık gelen konuşmaya kaydırılır; geri geçildiğinde seçili isteğe kaydırılır
- Ayarlar paneli: araç sonuçları ve düşünme blokları için varsayılan daraltma durumunu değiştirme
- Genel ayarlar: ilgisiz isteklerin (count_tokens, heartbeat) filtrelenmesini aç/kapat

### Çeviri

- Thinking blokları ve Assistant mesajları tek tıkla çeviriyi destekler
- Claude Haiku API tabanlı, yalnızca `x-api-key` kimlik doğrulaması kullanır (bağlam kirliliğini önlemek için OAuth oturum belirteçleri hariç tutulur)
- mainAgent isteklerinden haiku model adını otomatik olarak yakalar; varsayılan `claude-haiku-4-5-20251001`
- Çeviri sonuçları otomatik olarak önbelleğe alınır; orijinal metne dönmek için tekrar tıklayın
- Çeviri sırasında yükleme animasyonu gösterilir
- İstek detaylarındaki `authorization` başlığının yanındaki (?) simgesi bağlam kirliliği kavram belgesine bağlantı verir

### Token İstatistikleri

Başlık alanındaki üzerine gelme paneli:

- Modele göre gruplandırılmış Token sayıları (input/output)
- Cache creation/read sayıları ve cache isabet oranı
- Nedene göre gruplandırılmış cache yeniden oluşturma istatistikleri (TTL, system/tools/model değişikliği, mesaj kısaltma/değiştirme, key değişikliği) — sayı ve cache_creation token'ları ile birlikte
- Araç kullanım istatistikleri: araç başına çağrı sayısı, sıklığa göre sıralanmış
- Skill kullanım istatistikleri: Skill başına çağrı sıklığı, sıklığa göre sıralanmış
- Kavram yardımı (?) simgeleri: MainAgent, CacheRebuild ve her araç için yerleşik belgeleri görüntülemek üzere tıklayın
- Main Agent cache süre dolumu geri sayımı

### Log Yönetimi

Sol üstteki CC-Viewer açılır menüsü aracılığıyla:

- Yerel logları içe aktar: proje bazında gruplandırılmış geçmiş log dosyalarına göz at, yeni pencerede aç
- Yerel JSONL dosyası yükle: doğrudan yerel bir `.jsonl` dosyası seçip yükle (500MB'a kadar)
- Mevcut logu indir: mevcut izleme JSONL log dosyasını indir
- Logları birleştir: birden fazla JSONL log dosyasını birleşik analiz için tek bir oturumda birleştirin
- Kullanıcı Prompt'larını görüntüle: tüm kullanıcı girdilerini üç görüntüleme moduyla çıkarın ve görüntüleyin — Orijinal mod (ham içerik), Bağlam modu (sistem etiketleri daraltılabilir), Metin modu (yalnızca düz metin); eğik çizgi komutları (`/model`, `/context` vb.) bağımsız girişler olarak gösterilir; komutla ilgili etiketler Prompt içeriğinden otomatik olarak gizlenir
- Promptları TXT olarak dışa aktar: kullanıcı promptlarını (yalnızca metin, sistem etiketleri hariç) yerel bir `.txt` dosyasına aktar

### Çoklu Dil Desteği

CC-Viewer 18 dili destekler ve sistem yerel ayarına göre otomatik olarak geçiş yapar:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
