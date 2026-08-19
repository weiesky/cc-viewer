# SendMessage

Aktif bir ekip içinde bir ekip üyesinden diğerine bir mesaj iletir veya aynı anda tüm ekip arkadaşlarına yayın yapar. Ekip arkadaşlarının duyabildiği tek kanal budur — normal metin çıktısına yazılanlar onlara görünmez.

## Ne Zaman Kullanılır

- Ekip iş birliği sırasında bir görevi atamak veya bir alt problemi isimlendirilmiş bir ekip arkadaşına devretmek.
- Başka bir ajandan durum, ara bulgular veya bir kod incelemesi talep etmek.
- Tüm ekibe `*` aracılığıyla bir karar, paylaşılan kısıt veya kapatma duyurusu yayınlamak.
- Ekip lideri tarafından gelen bir kapatma isteği veya plan onay isteği gibi bir protokol istemine yanıt vermek.
- Devredilmiş bir görevin sonunda döngüyü kapatmak, böylece lider öğeyi tamamlanmış olarak işaretleyebilir.

## Etkinleştirme

- `ListAgents` ile aynı oturumlar arası mesajlaşma koşullarıyla sınırlıdır (sunucu tarafı özellik bayrakları, varsayılan olarak kapalı).
- Ekip arkadaşları ayrıca deneysel agent ekiplerinin etkinleştirilmiş olmasını gerektirir.

## Parametreler

- `to` (string, zorunlu): Ekipte kayıtlı hedef ekip arkadaşının `name`'i veya aynı anda tüm ekip arkadaşlarına yayın yapmak için `*`.
- `message` (string veya nesne, zorunlu): Normal iletişim için düz metin veya `shutdown_response` ve `plan_approval_response` gibi protokol yanıtları için yapılandırılmış bir nesne.
- `summary` (string, opsiyonel): Düz metin mesajları için ekip etkinlik günlüğünde gösterilen 5-10 kelimelik bir önizleme. Uzun string mesajlar için gereklidir; `message` bir protokol nesnesi olduğunda yok sayılır.

## Örnekler

### Örnek 1: Doğrudan görev devri

```
SendMessage(
  to="db-lead",
  message="Please audit prisma/schema.prisma and list any model missing createdAt/updatedAt timestamps. Reply when done.",
  summary="Audit schema for missing timestamps"
)
```

### Örnek 2: Paylaşılan bir kısıtı yayınlama

```
SendMessage(
  to="*",
  message="Reminder: do not touch files under legacy/ — that subtree is frozen until the migration PR lands.",
  summary="Freeze legacy/ during migration"
)
```

### Örnek 3: Protokol yanıtı

Liderden gelen bir kapatma isteğine yapılandırılmış bir mesajla yanıt verin:

```
SendMessage(
  to="leader",
  message={ "type": "shutdown_response", "ready": true, "final_report": "All assigned diff chunks committed on branch refactor-crew/db-lead." }
)
```

### Örnek 4: Plan onay yanıtı

```
SendMessage(
  to="leader",
  message={ "type": "plan_approval_response", "approved": true, "notes": "LGTM, but please split step 4 into migration + backfill." }
)
```

## Notlar

- Normal asistan metin çıktınız ekip arkadaşlarına iletilMEZ. Başka bir ajanın bir şeyi görmesini istiyorsanız, `SendMessage` üzerinden geçmelidir. Bu, ekip iş akışlarındaki en yaygın hatadır.
- Yayın (`to: "*"`) pahalıdır — tüm ekip arkadaşlarını uyandırır ve bağlamlarını tüketir. Bunu gerçekten herkesi etkileyen duyurular için saklayın. Hedefli göndermeleri tercih edin.
- Mesajları özlü ve eyleme yönelik tutun. Alıcının ihtiyaç duyduğu dosya yollarını, kısıtları ve beklenen yanıt formatını dahil edin; sizinle paylaşılan bellekleri olmadığını unutmayın.
- Protokol mesaj nesnelerinin (`shutdown_response`, `plan_approval_response`) sabit şekilleri vardır. Protokol alanlarını düz metin mesajlarıyla veya tersini karıştırmayın.
- Mesajlar eş zamansızdır. Alıcı sizinkini bir sonraki turunda alacaktır; onların yanıt verene kadar sizinkini okuduklarını veya buna göre hareket ettiklerini varsaymayın.
- İyi yazılmış bir `summary` ekip etkinlik günlüğünü lider için taranabilir kılar — onu bir commit konu satırı gibi ele alın.
