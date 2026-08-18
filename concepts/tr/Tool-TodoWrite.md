# TodoWrite

Mevcut oturum için yapılandırılmış bir todo listesi yazar ve önceki listeyi değiştirir. Her öğe metnini, bir durumunu ve ilerleme göstergelerinde gösterilen şimdiki-sürekli bir biçimi taşır.

## Ne Zaman Kullanılır

- Bir görevin birkaç farklı adımı vardır ve bunları izlemek sizin (ve kullanıcının) ilerlemeyi görmesine yardımcı olur.
- Kullanıcı açıkça bir todo listesi ister.
- Tam olarak bir öğeyi devam ediyor olarak işaretlemek istersiniz; geri kalanı bekliyor veya tamamlandı olarak kalır.

## Parametreler

- `todos` (dizi, zorunlu): Eksiksiz, güncellenmiş todo listesi. Her girdi şunları içerir:
  - `content` (string): Görev açıklaması.
  - `status` (string): Şunlardan biri: `pending`, `in_progress`, `completed`.
  - `activeForm` (string): Öğe devam ederken gösterilen şimdiki-sürekli metin (ör. "Running tests").

## Örnekler

### Örnek 1: Üç adımlı bir değişikliği izlemek

```
TodoWrite(
  todos=[
    {content="Update the parser", status="in_progress", activeForm="Updating the parser"},
    {content="Add unit tests", status="pending", activeForm="Adding unit tests"},
    {content="Run the full test suite", status="pending", activeForm="Running the full test suite"}
  ]
)
```

Tüm liste her çağrıda yeniden yazılır — yalnızca değişenleri değil, her zaman tüm öğeleri dahil edin.

## Notlar

- Liste her çağrıda tamamen değiştirilir; tek bir öğeyi güncellemek için her öğeyi yeni durumuyla yeniden gönderin.
- Aynı anda tam olarak bir öğeyi `in_progress` olarak tutun.
- Yapılandırılmış görev araçlarının (`TaskCreate`/`TaskUpdate`/`TaskList`) etkin olduğu oturumlarda harness bunları `TodoWrite` yerine sunabilir — hangi araç seti reklam ediliyorsa onu tercih edin.
