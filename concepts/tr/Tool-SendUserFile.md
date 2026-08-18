# SendUserFile

Bir veya daha fazla dosyayı kullanıcıya gönderir — oluşturulan yapıtlar, ekran görüntüleri, raporlar — istemcinin bunları nasıl sunacağı üzerinde kontrolle.

## Ne Zaman Kullanılır

- Kullanıcının ihtiyaç duyduğu bir dosya ürettiniz (bir rapor, bir görüntü, bir HTML sayfası) ve yalnızca yolundan bahsetmek yerine onu öne çıkarmak istiyorsunuz.
- Ekli bir yanıt verme (`status="normal"`) veya kullanıcının istemediği ancak şimdi görmesi gereken bir şeyi proaktif olarak öne çıkarma (`status="proactive"`).

## Etkinleştirme

- Yalnızca bir Remote Control istemcisi bağlıyken veya oturum yönetilen bir bulut ortamında çalışırken kullanılabilir (ör. web üzerinde Claude Code).
- Amazon Bedrock, Google Cloud veya Microsoft Foundry'de kullanılamaz.
- Oturumun dosya göndermeye izin vermesini gerektirir (ayarlar/özellik bayrağı ile kısıtlanmış bir yetenek); brief modunda sunulmaz.

## Parametreler

- `files` (string dizisi, zorunlu): Kullanıcıya gönderilecek dosya yolları (mutlak veya çalışma dizinine göreli). Tek bir dosya için bile her zaman bir dizi geçirin.
- `caption` (string, opsiyonel): Dosya(lar) için kısa başlık.
- `status` (string, zorunlu): Kullanıcının istemediği ve şimdi görmesi gereken bir dosyayı öne çıkarırken `proactive` — oluşturulan bir yapıt, tamamlanmış bir rapor; kullanıcının az önce söylediği bir şeye yanıt verirken `normal`.
- `display` (string, opsiyonel): `render` dosyayı yan panelde satır içi açar (HTML, SVG, Mermaid, görüntüler, PDF'ler); `attach` yalnızca bir indirme kartı gösterir (kullanıcının kaydedip başka yerde açacağı çıktılar). İstemcinin dosya türüne göre karar vermesi için atlayın.

## Örnekler

### Örnek 1: Oluşturulan bir raporu teslim etmek

```
SendUserFile(
  files=["./out/weekly-report.html"],
  caption="Weekly usage report",
  status="proactive",
  display="render"
)
```

## Notlar

- Kullanıcının kaydedip başka bir uygulamada açacağı dosyalar için `display="attach"`; hemen bakması gereken her şey için `render` seçin.
