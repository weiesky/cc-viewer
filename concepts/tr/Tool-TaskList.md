# TaskList

Mevcut ekipteki (veya oturumdaki) her görevi özet biçimde döndürür. Beklenen işi incelemek, sıradaki görevi almaya karar vermek ve yinelenenler oluşturmaktan kaçınmak için kullanın.

## Ne Zaman Kullanılır

- Bir oturumun başında neyin zaten izlendiğini görmek.
- `TaskCreate` çağırmadan önce, işin zaten yakalanmadığını doğrulamak.
- Bir ekip arkadaşı veya alt ajan olarak sıradaki görevi almaya karar verirken.
- Tek bakışta ekip genelindeki bağımlılık ilişkilerini doğrulamak.
- Uzun oturumlar sırasında periyodik olarak, görevleri talep etmiş, tamamlamış veya eklemiş olabilecek ekip arkadaşlarıyla yeniden senkronize olmak.

`TaskList` yalnızca okumadır ve ucuzdur; bir genel bakışa ihtiyaç duyduğunuzda serbestçe çağırın.

## Etkinleştirme

- Çoğu modelde varsayılan olarak kullanılabilir.
- `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` veya `--tools` ile katılım sağlanmadıkça Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 ve sonraki ailelerde (v2.1.233+) kullanılamaz.
- `CLAUDE_CODE_ENABLE_TASKS=false` olduğunda tüm görev sistemi devre dışıdır.

## Parametreler

`TaskList` parametre almaz. Her zaman aktif bağlam için tam görev kümesini döndürür.

## Yanıt Şekli

Listedeki her görev bir özettir, tam kayıt değildir. Yaklaşık olarak şunu bekleyin:

- `id` — `TaskGet` / `TaskUpdate` ile kullanım için kararlı tanımlayıcı.
- `subject` — kısa buyurgan başlık.
- `status` — `pending`, `in_progress`, `completed`, `deleted`'den biri.
- `owner` — ajan veya ekip arkadaşı handle'ı veya talep edilmediğinde boş.
- `blockedBy` — önce tamamlanması gereken görev ID'leri dizisi.

Belirli bir görevin tam açıklamasını, kabul kriterlerini veya meta verilerini almak için `TaskGet` ile takip edin.

## Örnekler

### Örnek 1

Hızlı durum kontrolü.

```
TaskList()
```

Çıktıyı `owner`'ı olmayan (stale iş) `in_progress` ve `blockedBy`'ı boş (alınmaya hazır) `pending` için tarayın.

### Örnek 2

Sıradaki görevi alan bir ekip arkadaşı.

```
TaskList()
# Filter to: status == pending AND blockedBy is empty AND owner is empty.
# Among those, prefer the lower ID (tasks are typically numbered in
# creation order, so lower IDs are older and usually higher priority).
TaskGet(taskId: "<chosen id>")
TaskUpdate(taskId: "<chosen id>", status: "in_progress", owner: "<your handle>")
```

## Notlar

- Ekip arkadaşı sezgiseli: birden fazla `pending` görev engellenmemiş ve sahipsiz olduğunda, en düşük ID'yi seçin. Bu, işi FIFO'da tutar ve iki ajanın aynı yüksek profilli görevi almasını önler.
- `blockedBy`'a saygı gösterin: engelleyicileri hala `pending` veya `in_progress` olan bir göreve başlamayın. Önce engelleyiciyi çalıştırın veya sahibiyle koordine olun.
- `TaskList` görevler için tek keşif mekanizmasıdır. Arama yoktur; liste uzunsa yapısal olarak (önce duruma, sonra sahibe göre) tarayın.
- Silinen görevler izlenebilirlik için hala listede `deleted` durumuyla görünebilir. Planlama amaçları için onları yok sayın.
- Liste ekibin canlı durumunu yansıtır, bu yüzden ekip arkadaşları çağrılar arasında görev ekleyebilir veya talep edebilir. Zaman geçtiyse talep etmeden önce yeniden listeleyin.
