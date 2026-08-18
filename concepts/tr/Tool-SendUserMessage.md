# SendUserMessage

Kullanıcıya bir mesaj gönderir — brief tarzı oturumlarda birincil görünür çıktı kanalı. Eski takma adı `Brief` olarak da bilinir.

## Ne Zaman Kullanılır

- Kullanıcının az önce söylediği bir şeye yanıt verme (`status="normal"`).
- Kullanıcının istemediği ve şimdi görmesi gereken bir şeyi proaktif olarak öne çıkarma — uzaktayken tamamlanan bir görev, karşılaştığınız bir engel, istenmemiş bir durum güncellemesi (`status="proactive"`).

## Parametreler

Brief modunda:

- `message` (string, zorunlu): Kullanıcı için mesaj. Markdown biçimlendirmesini destekler.
- `attachments` (dizi, opsiyonel): Mesajın yanında gösterilen ekler. Her girdi ya yerel olarak okunabilir bir dosya için bir dosya yolu (mutlak veya çalışma dizinine göreli) ya da `attach_file` gibi bir cihaz aracından elde edilen, önceden çözümlenmiş bir `{file_uuid, file_name, size, is_image}` nesnesidir.
- `status` (string, zorunlu): Kullanıcının şimdi ihtiyaç duyduğu istenmemiş güncellemeler için `proactive`; kullanıcıya yanıt verirken `normal`.

Brief olmayan derlemelerde yalnızca `message` mevcuttur.

## Örnekler

### Örnek 1: Proaktif tamamlama bildirimi

```
SendUserMessage(
  message="The migration finished — 42 files updated, tests green.",
  status="proactive"
)
```

## Notlar

- Yalnızca brief modunda veya ilgili özellik dağıtımı aracılığıyla etkindir; çoğu etkileşimli CLI oturumu bunun yerine doğrudan kullanıcıyla konuşur.
- `proactive`'i idareli kullanın — gerçekten şimdi kullanıcının dikkatini gerektiren şeyler içindir.
