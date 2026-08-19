# SendFeedback

Claude Code hakkında Anthropic'e yapılandırılmış geri bildirim gönderir — hata raporları, özellik fikirleri veya eksik yetenekler — oturumdan ayrılmadan.

## Ne Zaman Kullanılır

- Kullanıcı, Claude Code'un kendisi hakkında bir hata bildirmeyi veya geri bildirim göndermeyi ister.
- Bildirilmeye değer net bir ürün kusuruyla karşılaşırsınız (bozuk komut, yanlış davranış, çökme).
- Kullanıcı, var olmasını dilediği bir özelliği tanımlar (bir fikir veya eksik yetenek).

## Parametreler

- `type` (string, zorunlu): Şunlardan biri: `bug`, `idea`, `missing_capability`.
- `title` (string, zorunlu): Sorunun kısa, spesifik, tek satırlık özeti.
- `details` (string, zorunlu): Etiketli madde işaretleri, sırasıyla: **What happened:** (gözlemlenen ve beklenen, kısaysa tam hata metni); **What the user said:** (alıntılanmış veya "User didn't comment; observed by the model."); **Repro:** (minimal adımlar); **Evidence:** (istek kimlikleri, zaman damgaları, yollar, sürümler — yoksa atlayın); isteğe bağlı olarak son bir **Cause:** yalnızca oturum içinde doğrulandıysa. Madde başına bir ila üç satır; anlatı paragrafları, spekülasyon veya gizli bilgi yok.
- `area` (string, opsiyonel): Bunun Claude Code'un hangi bölümüyle ilgili olduğunu adlandıran kısa etiket (ör. "hooks config", "/help", "file editing"). Belirsizse boş bırakın.
- `failure_mode` (string, opsiyonel): Model davranışı raporları için en yakın hata modu (ör. `instruction_following`, `repetition_and_looping`, `context_and_memory`, `stopping_short` veya `other`). Yalnızca rapor saf bir ürün/araç hatasıysa atlayın.
- `task_category` (string, opsiyonel): Sorun oluştuğunda oturumun yaptığı iş: `code_edit`, `debug`, `explain`, `plan`, `shell`, `search`, `review` veya `other`.

## Örnekler

### Örnek 1: Bir ürün hatası bildirmek

```
SendFeedback(
  type="bug",
  title="/export truncates the last message",
  details="**What happened:** exported transcript is missing the final assistant message.\n**What the user said:** \"the last reply never shows up in the file\".\n**Repro:** run /export after any multi-turn session.\n**Evidence:** v2.1.233, macOS.",
  area="/export",
  task_category="other"
)
```

## Notlar

- `details` içinde asla gizli bilgilere, token'lara veya özel kullanıcı verilerine yer vermeyin.
- Mevcut olduğunda kullanıcının sözlerini alıntılayın; aksi takdirde sorunu modelin gözlemlediğini belirtin.
- Raporu olgusal tutun — kök neden hakkındaki spekülasyon yalnızca oturum içinde doğrulandığında `**Cause:**` bölümüne aittir.
