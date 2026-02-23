# CC-Viewer

Claude Code için tüm API isteklerini ve yanıtlarını gerçek zamanlı olarak yakalayan ve görselleştiren bir istek izleme sistemi. Geliştiricilerin Vibe Coding sırasında Context'i inceleme ve hata ayıklama amacıyla izlemelerine yardımcı olur.

[简体中文](./README.zh.md) | [English](../README.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Українська](./README.uk.md)

## Kullanım

```bash
npm install -g cc-viewer
```

Kurulumdan sonra çalıştırın:

```bash
ccv
```

Bu komut, yerel olarak kurulu Claude Code'unuzu izleme için otomatik olarak yapılandırır ve shell yapılandırmanıza (`~/.zshrc` veya `~/.bashrc`) otomatik onarım hook'u ekler. Ardından Claude Code'u her zamanki gibi kullanın ve izleme arayüzünü görüntülemek için tarayıcınızda `http://localhost:7008` adresini açın.

Claude Code güncellemesinden sonra manuel işlem gerekmez — bir sonraki `claude` çalıştırmanızda otomatik olarak algılayıp yeniden yapılandırır.

### Kaldırma

```bash
ccv --uninstall
```

## Özellikler

### İstek İzleme (Raw Modu)

- Claude Code'dan gelen tüm API isteklerinin gerçek zamanlı yakalanması, streaming yanıtlar dahil
- Sol panel istek yöntemini, URL'yi, süreyi ve durum kodunu gösterir
- Main Agent ve Sub Agent isteklerini otomatik olarak tanımlar ve etiketler (alt türler: Bash, Task, Plan, General)
- Sağ panel Request / Response sekme geçişini destekler
- Request Body varsayılan olarak `messages`, `system`, `tools` öğelerini bir seviye genişletir
- Response Body varsayılan olarak tamamen genişletilir
- JSON görünümü ile düz metin görünümü arasında geçiş
- Tek tıkla JSON içeriği kopyalama
- MainAgent istekleri Body Diff JSON'u destekler, önceki MainAgent isteğiyle farkları katlanmış olarak gösterir (yalnızca değişen/eklenen alanlar)
- Body Diff JSON araç ipucu kapatılabilir; kapatıldığında tercih sunucu tarafında kaydedilir ve bir daha gösterilmez
- Hassas başlıklar (`x-api-key`, `authorization`) kimlik bilgisi sızıntısını önlemek için JSONL log dosyalarında otomatik olarak maskelenir
- İstek başına satır içi Token kullanım istatistikleri (giriş/çıkış token'ları, önbellek oluşturma/okuma, isabet oranı)

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
- Sistem metni otomatik filtrelenir, yalnızca gerçek kullanıcı girişi gösterilir
- Çoklu session segmentli görüntüleme (`/compact`, `/clear` vb. sonrasında otomatik segmentleme)
- Her mesaj saniye hassasiyetinde zaman damgası gösterir, API istek zamanlamasından türetilmiş
- Ayarlar paneli: araç sonuçları ve düşünme blokları için varsayılan daraltma durumunu değiştirme

### Çeviri

- Thinking blokları ve Assistant mesajları tek tıkla çeviriyi destekler
- Claude Haiku API tabanlı, hem API Key (`x-api-key`) hem de OAuth Bearer Token kimlik doğrulamasını destekler
- Çeviri sonuçları otomatik olarak önbelleğe alınır; orijinal metne geri dönmek için tekrar tıklayın
- Çeviri sırasında yükleme döndürücü animasyonu gösterilir

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
- Kullanıcı promptlarını dışa aktar: tüm kullanıcı girişlerini çıkar ve görüntüle, XML etiketleri (system-reminder vb.) daraltılabilir; eğik çizgi komutları (`/model`, `/context` vb.) bağımsız girişler olarak gösterilir; komutla ilgili etiketler prompt içeriğinden otomatik olarak gizlenir
- Promptları TXT olarak dışa aktar: kullanıcı promptlarını (yalnızca metin, sistem etiketleri hariç) yerel bir `.txt` dosyasına aktar

### Çoklu Dil Desteği

CC-Viewer 18 dili destekler ve sistem yerel ayarına göre otomatik olarak geçiş yapar:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
