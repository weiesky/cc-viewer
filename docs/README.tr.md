# CC-Viewer

Claude Code için tüm API isteklerini ve yanıtlarını gerçek zamanlı olarak yakalayan ve görselleştiren bir istek izleme sistemi. Geliştiricilerin Vibe Coding sırasında Context'i inceleme ve hata ayıklama amacıyla izlemelerine yardımcı olur.

[简体中文](../README.md) | [English](./README.en.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Українська](./README.uk.md)

## Kullanım

```bash
npm install -g cc-viewer
```

Kurulumdan sonra çalıştırın:

```bash
ccv
```

Bu komut, yerel olarak kurulu Claude Code'unuza izleme betiğini otomatik olarak enjekte eder ve shell yapılandırmanıza (`~/.zshrc` veya `~/.bashrc`) otomatik yeniden enjeksiyon hook'u ekler. Ardından Claude Code'u her zamanki gibi kullanın ve izleme arayüzünü görüntülemek için tarayıcınızda `http://localhost:7008` adresini açın.

Claude Code güncellemesinden sonra manuel işlem gerekmez — bir sonraki `claude` çalıştırmanızda otomatik olarak algılayıp yeniden enjekte eder.

### Kaldırma

```bash
ccv --uninstall
```

cli.js enjeksiyonunu ve shell yapılandırma hook'unu tek adımda temizler.

## Özellikler

### İstek İzleme (Raw Modu)

- Claude Code'dan gelen tüm API isteklerinin gerçek zamanlı yakalanması, streaming yanıtlar dahil
- Sol panel istek yöntemini, URL'yi, süreyi ve durum kodunu gösterir
- Main Agent ve Sub Agent isteklerini otomatik olarak tanımlar ve etiketler
- Sağ panel Request / Response sekme geçişini destekler
- Request Body varsayılan olarak `messages`, `system`, `tools` öğelerini bir seviye genişletir
- Response Body varsayılan olarak tamamen genişletilir
- JSON görünümü ile düz metin görünümü arasında geçiş
- Tek tıkla JSON içeriği kopyalama
- MainAgent istekleri Body Diff JSON'u destekler, önceki MainAgent isteğiyle farkları katlanmış olarak gösterir (yalnızca değişen/eklenen alanlar)

### Chat Modu

Main Agent'ın tam konuşma geçmişini sohbet arayüzüne dönüştürmek için sağ üstteki "Chat modu" düğmesine tıklayın:

- Kullanıcı mesajları sağa hizalı (mavi balonlar), Main Agent yanıtları sola hizalı (koyu balonlar) Markdown oluşturma desteğiyle
- `/compact` mesajları otomatik algılanır ve daraltılmış gösterilir, tam özeti genişletmek için tıklayın
- Araç çağrısı sonuçları ilgili Assistant mesajı içinde satır içi görüntülenir
- `thinking` blokları varsayılan olarak daraltılmış, genişletmek için tıklayın
- `tool_use` kompakt araç çağrısı kartları olarak gösterilir (Bash, Read, Edit, Write, Glob, Grep, Task her biri özel görünüme sahip)
- Kullanıcı seçim mesajları (AskUserQuestion) soru-cevap formatında gösterilir
- Sistem enjeksiyon etiketleri (`<system-reminder>`, `<project-reminder>`, vb.) otomatik daraltılır
- Sistem tarafından enjekte edilen metin otomatik filtrelenir, yalnızca gerçek kullanıcı girişi gösterilir
- Çoklu session segmentli görüntüleme (`/compact`, `/clear` vb. sonrasında otomatik segmentleme)
- Her mesaj saniye hassasiyetinde zaman damgası gösterir

### Token İstatistikleri

Başlık alanındaki üzerine gelme paneli:

- Modele göre gruplandırılmış Token sayıları (input/output)
- Cache creation/read sayıları ve cache isabet oranı
- Main Agent cache süre dolumu geri sayımı

### Log Yönetimi

Sol üstteki CC-Viewer açılır menüsü aracılığıyla:

- Yerel logları içe aktar: proje bazında gruplandırılmış geçmiş log dosyalarına göz at, yeni pencerede aç
- Yerel JSONL dosyası yükle: doğrudan yerel bir `.jsonl` dosyası seçip yükle (200MB'a kadar)
- Mevcut logu indir: mevcut izleme JSONL log dosyasını indir
- Kullanıcı promptlarını dışa aktar: tüm kullanıcı girişlerini çıkar ve görüntüle, system-reminder daraltılabilir görünümüyle
- Promptları TXT olarak dışa aktar: kullanıcı promptlarını yerel bir `.txt` dosyasına aktar

### Çoklu Dil Desteği

CC-Viewer 18 dili destekler ve sistem yerel ayarına göre otomatik olarak geçiş yapar:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
