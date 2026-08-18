# TaskCreate

Mevcut ekibin görev listesinde (veya etkin bir ekip yoksa oturumun görev listesinde) yeni bir görev oluşturur. İzlenmesi, devredilmesi veya daha sonra tekrar ziyaret edilmesi gereken iş öğelerini yakalamak için kullanın.

## Ne Zaman Kullanılır

- Kullanıcı, açık izlemeden yararlanan çok adımlı bir iş parçası tanımlar.
- Büyük bir isteği daha küçük, ayrı tamamlanabilir birimlere ayırıyorsunuz.
- Görev ortasında bir takip keşfedilir ve unutulmaması gerekir.
- Çalışmayı bir ekip arkadaşına veya alt ajana devretmeden önce niyetin kalıcı bir kaydına ihtiyacınız var.
- Plan modunda çalışıyorsunuz ve her plan adımının somut bir görev olarak temsil edilmesini istiyorsunuz.

Önemsiz tek seferlik eylemler, saf konuşma veya iki veya üç doğrudan araç çağrısıyla tamamlanabilecek her şey için `TaskCreate`'i atlayın.

## Etkinleştirme

- Çoğu modelde varsayılan olarak kullanılabilir.
- `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` veya `--tools` ile katılım sağlanmadıkça Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 ve sonraki ailelerde (v2.1.233+) kullanılamaz.
- `CLAUDE_CODE_ENABLE_TASKS=false` olduğunda tüm görev sistemi devre dışıdır.

## Parametreler

- `subject` (string, zorunlu): Kısa buyurgan başlık, örneğin `Fix login redirect on Safari`. Yaklaşık seksen karakter altında tutun.
- `description` (string, zorunlu): Ayrıntılı bağlam — problem, kısıtlar, kabul kriterleri ve gelecekteki bir okuyucunun ihtiyaç duyacağı dosyalar veya bağlantılar. Bir ekip arkadaşının bunu soğuk olarak alacakmış gibi yazın.
- `activeForm` (string, opsiyonel): Görev `in_progress` iken gösterilen şimdiki-sürekli dönen metin, örneğin `Fixing login redirect on Safari`. `subject`'i yansıtın ancak -ing formunda.
- `metadata` (object, opsiyonel): Göreve eklenen keyfi yapılandırılmış veri. Yaygın kullanımlar: etiketler, öncelik ipuçları, dış bilet ID'leri veya ajana özgü yapılandırma.

Yeni oluşturulan görevler her zaman `pending` durumuyla ve sahibi olmadan başlar. Bağımlılıklar (`blocks`, `blockedBy`) oluşturma zamanında ayarlanmaz — daha sonra `TaskUpdate` ile uygulayın.

## Örnekler

### Örnek 1

Kullanıcının az önce dosyaladığı bir hata raporunu yakalayın.

```
TaskCreate(
  subject: "Repair broken PDF export on Windows",
  description: "Users on Windows 11 report the export button produces a 0-byte file. Reproduce with sample doc in test/fixtures/export/, then fix the code path in src/export/pdf.ts. Acceptance: export writes a valid PDF and the existing export test suite passes.",
  activeForm: "Repairing broken PDF export on Windows"
)
```

### Örnek 2

Bir oturumun başında bir epic'i izlenen birimlere bölün.

```
TaskCreate(
  subject: "Draft migration plan for auth service",
  description: "Produce a written plan covering rollout stages, rollback strategy, and monitoring. Output: docs/auth-migration.md.",
  activeForm: "Drafting migration plan for auth service",
  metadata: { "priority": "P1", "linearId": "AUTH-214" }
)
```

## Notlar

- `subject`'i buyurgan sesle ve `activeForm`'u şimdiki sürekli olarak yazın, böylece görev `in_progress`'e geçtiğinde arayüz doğal bir şekilde okunur.
- Yinelenenlerden kaçınmak için oluşturmadan önce `TaskList` çağırın — ekip listesi ekip arkadaşları ve alt ajanlarla paylaşılır.
- `description` veya `metadata` içinde sırları veya kimlik bilgilerini dahil etmeyin; görev kayıtları ekibe erişimi olan herkese görünür.
- Oluşturmadan sonra, görevi `TaskUpdate` ile yaşam döngüsünden geçirin. Çalışmayı sessizce `in_progress`'te terk edilmiş bırakmayın.
