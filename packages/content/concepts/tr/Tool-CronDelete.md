# CronDelete

`CronCreate` ile daha önce zamanlanmış bir cron işini iptal eder. Bellek içi oturum deposundan hemen kaldırır. İş zaten otomatik olarak silinmişse (tek seferlik işler tetiklendikten sonra kaldırılır, yinelenen işler 7 gün sonra otomatik olarak sona erer) herhangi bir etkisi yoktur.

## Ne Zaman Kullanılır

- Bir kullanıcı, 7 günlük otomatik süresi dolmadan önce yinelenen zamanlanmış bir görevi durdurmayı istediğinde.
- Tek seferlik bir iş artık gerekli değilse ve tetiklenmeden önce iptal edilmesi gerektiğinde.
- Mevcut bir işin zamanlama ifadesinin değiştirilmesi gerektiğinde — `CronDelete` ile silin, ardından yeni ifadeyi kullanarak `CronCreate` ile yeniden oluşturun.
- Oturum deposunu düzenli tutmak için birden fazla eski işi temizlemek.

## Parametreler

- `id` (string, gerekli): İş ilk oluşturulduğunda `CronCreate` tarafından döndürülen iş kimliği. Bu değer tam olarak eşleşmelidir; belirsiz veya ada dayalı arama desteklenmez.

## Örnekler

### Örnek 1: Çalışan bir yinelenen işi iptal etme

`"cron_abc123"` kimliğine sahip bir yinelenen iş daha önce oluşturulmuştu. Kullanıcı onu durdurmayı istiyor.

```
CronDelete({ id: "cron_abc123" })
```

İş oturum deposundan kaldırılır ve bir daha tetiklenmez.

### Örnek 2: Tetiklenmeden önce eski bir tek seferlik işi kaldırma

`"cron_xyz789"` kimliğine sahip tek seferlik bir iş 30 dakika sonra çalışacak şekilde zamanlandı, ancak kullanıcı artık gerekli olmadığına karar verdi.

```
CronDelete({ id: "cron_xyz789" })
```

İş iptal edilir. Özgün tetikleme zamanı geldiğinde hiçbir işlem yapılmaz.

## Notlar

- `id`, `CronCreate`'in dönüş değerinden alınmalıdır. Bir işi açıklama veya geri çağırma ile aramanın yolu yoktur — daha sonra iptal etmeniz gerekebilirse kimliği saklayın.
- İş zaten otomatik olarak silinmişse (tek seferlik iş olarak tetiklendi veya 7 günlük yinelenen süre dolumuna ulaştı), bu kimlikle `CronDelete` çağırmak etkisiz bir işlemdir ve hata oluşturmaz.
- `CronDelete` yalnızca geçerli bellek içi oturumu etkiler. Çalışma zamanı ortamı yeniden başlatmalar arasında cron durumunu sürdürmüyorsa, `CronDelete` çağrılıp çağrılmadığından bağımsız olarak yeniden başlatmada zamanlanmış işler kaybolur.
- Toplu silme işlemi yoktur; her işi kendi `id`'sini kullanarak tek tek iptal edin.
