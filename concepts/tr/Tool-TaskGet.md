# TaskGet

ID'ye göre tek bir görevin tam kaydını getirir — açıklaması, mevcut durumu, sahibi, meta verileri ve bağımlılık kenarları dahil. `TaskList` tarafından döndürülen özet, görev üzerinde hareket etmek için yeterli olmadığında kullanın.

## Ne Zaman Kullanılır

- `TaskList`'ten bir görev aldınız ve çalışmaya başlamadan önce tam açıklamaya ihtiyacınız var.
- Bir görevi `completed` olarak işaretlemek üzeresiniz ve kabul kriterlerini yeniden kontrol etmek istiyorsunuz.
- Bu görevin hangilerini `blocks` veya hangileri tarafından `blockedBy` olduğunu incelemek için bir sonraki hamleye karar vermek.
- Geçmişi inceliyorsunuz — kim sahibi, hangi meta veriler ekli, durumunun ne zaman değiştiği.
- Bir ekip arkadaşı veya önceki oturum bir görev ID'sine atıfta bulundu ve bağlama ihtiyacınız var.

Yalnızca yüksek düzey bir tarama yapmak istediğinizde `TaskList`'i tercih edin; `TaskGet`'i dikkatlice okumayı veya değiştirmeyi planladığınız belirli kayıt için saklayın.

## Etkinleştirme

- Çoğu modelde varsayılan olarak kullanılabilir.
- `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` veya `--tools` ile katılım sağlanmadıkça Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 ve sonraki ailelerde (v2.1.233+) kullanılamaz.
- `CLAUDE_CODE_ENABLE_TASKS=false` olduğunda tüm görev sistemi devre dışıdır.

## Parametreler

- `taskId` (string, zorunlu): `TaskCreate` veya `TaskList` tarafından döndürülen görev tanımlayıcısı. ID'ler görevin ömrü boyunca kararlıdır.

## Örnekler

### Örnek 1

Listede az önce gördüğünüz bir görevi arayın.

```
TaskGet(taskId: "t_01HXYZ...")
```

Tipik yanıt alanları: `id`, `subject`, `description`, `activeForm`, `status`, `owner`, `blocks`, `blockedBy`, `metadata`, `createdAt`, `updatedAt`.

### Örnek 2

Başlamadan önce bağımlılıkları çözün.

```
TaskGet(taskId: "t_01HXYZ...")
# Inspect blockedBy — if any referenced task is still pending
# or in_progress, work on the blocker first.
```

## Notlar

- `TaskGet` yalnızca okumadır ve tekrar tekrar çağırmak güvenlidir; durumu veya sahipliği değiştirmez.
- `blockedBy` boş değilse ve `completed` olmayan görevler içeriyorsa, bu göreve başlamayın — önce engelleyicileri çözün (veya sahibiyle koordine olun).
- `description` alanı uzun olabilir. Harekete geçmeden önce tam olarak okuyun; gözden kaçırma, gözden kaçırılan kabul kriterlerine yol açar.
- Bilinmeyen veya silinmiş bir `taskId` hata döndürür. Mevcut bir ID seçmek için `TaskList`'i yeniden çalıştırın.
- Bir görevi düzenlemek üzereyseniz, bir ekip arkadaşının az önce değiştirdiği alanların üzerine yazmamak için önce `TaskGet` çağırın.
