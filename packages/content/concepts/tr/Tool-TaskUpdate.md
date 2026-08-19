# TaskUpdate

Var olan bir görevi değiştirir — durumu, içeriği, sahipliği, meta verileri veya bağımlılık kenarları. Görevler bu şekilde yaşam döngülerinde ilerler ve Claude Code, ekip arkadaşları ve alt ajanlar arasında bu şekilde devredilir.

## Ne Zaman Kullanılır

- Üzerinde çalıştıkça görevi durum iş akışında geçiriyorsunuz.
- Kendinizi (veya başka bir ajanı) `owner` olarak atayarak bir görevi talep ediyorsunuz.
- Problem hakkında daha fazlasını öğrendikten sonra `subject` veya `description`'ı iyileştirmek.
- Yeni keşfedilen bağımlılıkları `addBlocks` / `addBlockedBy` ile kaydetmek.
- Dış bilet ID'leri veya öncelik ipuçları gibi yapılandırılmış `metadata` eklemek.

## Etkinleştirme

- Çoğu modelde varsayılan olarak kullanılabilir.
- `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` veya `--tools` ile katılım sağlanmadıkça Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 ve sonraki ailelerde (v2.1.233+) kullanılamaz.
- `CLAUDE_CODE_ENABLE_TASKS=false` olduğunda tüm görev sistemi devre dışıdır.

## Parametreler

- `taskId` (string, zorunlu): Değiştirilecek görev. `TaskList` veya `TaskCreate`'den alın.
- `status` (string, opsiyonel): `pending`, `in_progress`, `completed`, `deleted`'den biri.
- `subject` (string, opsiyonel): Yerine geçen buyurgan başlık.
- `description` (string, opsiyonel): Yerine geçen ayrıntılı açıklama.
- `activeForm` (string, opsiyonel): Yerine geçen şimdiki-sürekli dönen metin.
- `owner` (string, opsiyonel): Görev için sorumluluk alan ajan veya ekip arkadaşı handle'ı.
- `metadata` (object, opsiyonel): Göreve birleştirilecek meta veri anahtarları. Bir anahtarı silmek için `null`'a ayarlayın.
- `addBlocks` (string dizisi, opsiyonel): Bu görevin engellediği görev ID'leri.
- `addBlockedBy` (string dizisi, opsiyonel): Bundan önce tamamlanması gereken görev ID'leri.

## Durum İş Akışı

Yaşam döngüsü kasıtlı olarak doğrusaldır: `pending` → `in_progress` → `completed`. `deleted` son durumdur ve asla üzerinde çalışılmayacak görevleri geri çekmek için kullanılır.

- Çalışmaya başladığınız an `in_progress`'e ayarlayın, öncesinde değil. Belirli bir sahip için aynı anda yalnızca bir görev `in_progress` olmalıdır.
- Yalnızca iş tamamen bittiğinde `completed`'a ayarlayın — kabul kriterleri karşılandı, testler geçti, çıktı yazıldı. Bir engel belirirse, görevi `in_progress`'te tutun ve çözülmesi gerekeni açıklayan yeni bir görev ekleyin.
- Testler başarısız olduğunda, uygulama kısmi olduğunda veya çözülmemiş hatalara isabet ettiğinizde asla bir görevi `completed` olarak işaretlemeyin.
- İptal edilen veya yinelenen görevler için `deleted` kullanın; bir görevi ilgisiz iş için yeniden kullanmayın.

## Örnekler

### Örnek 1

Bir görevi talep edin ve başlatın.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "in_progress",
  owner: "main-agent"
)
```

### Örnek 2

İşi bitirin ve bir takip bağımlılığı kaydedin.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "completed"
)

TaskUpdate(
  taskId: "t_01FOLLOWUP...",
  addBlockedBy: ["t_01HXYZ..."]
)
```

## Notlar

- `metadata` anahtar anahtar birleşir; bir anahtar için `null` geçirmek onu kaldırır. Mevcut içerikten emin değilseniz önce `TaskGet` çağırın.
- `addBlocks` ve `addBlockedBy` kenarları ekler; mevcut olanları kaldırmazlar. Grafiği yıkıcı bir şekilde düzenlemek özel bir iş akışı gerektirir — bağımlılıkları yeniden yazmadan önce ekip sahibine danışın.
- `subject`'i değiştirdiğinizde `activeForm`'u senkronize tutun, böylece dönen metin doğal okunmaya devam eder.
- Bir görevi susturmak için `completed` olarak işaretlemeyin. Kullanıcı işi iptal ettiyse, `description`'da kısa bir gerekçe ile `deleted` kullanın.
- Güncellemeden önce `TaskGet` ile bir görevin en son durumunu okuyun — ekip arkadaşları son okumanızla yazmanız arasında değiştirmiş olabilir.
