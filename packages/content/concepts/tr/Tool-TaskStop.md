# TaskStop

Çalışan bir arka plan görevini — bir kabuk komutu, gönderilen bir ajan veya uzak bir oturum — çalışma zamanı handle'ına göre durdurur. Kaynakları geri kazanmak, artık yararlı olmayan işi iptal etmek veya bir görev takıldığında kurtarmak için kullanın.

## Ne Zaman Kullanılır

- Bir arka plan kabuk komutu beklenenden uzun süre çalıştı ve artık sonucuna ihtiyacınız yok.
- Yerel bir ajan döngüde veya takıldı ve kısaltılması gerekiyor.
- Kullanıcı yön değiştirdi ve önceki yön için arka plan işi terk edilmelidir.
- Uzak bir oturum zaman aşımına uğramak üzere veya ihtiyacınız olan bir kaynağı tutuyor.
- Aynı görevin yeni bir çalıştırmasından önce temiz bir slate'e ihtiyacınız var.

Kısa ömürlü arka plan işinin kendi kendine bitmesine izin vermeyi tercih edin. `TaskStop`, devam eden yürütmenin hiçbir değeri olmadığı veya aktif olarak zararlı olduğu durumlar içindir.

## Parametreler

- `task_id` (string, zorunlu): Arka plan görevi başlatıldığında döndürülen çalışma zamanı handle'ı. Bu, `TaskOutput` tarafından kabul edilen aynı tanımlayıcıdır, task-list `taskId` değil.

## Örnekler

### Örnek 1

Kaçak bir arka plan kabuk komutunu durdurun.

```
TaskStop(task_id: "bash_01HXYZ...")
```

Komut bir sonlandırma sinyali alır; o ana kadar yazılan arabellekli çıktı çıktı yolunda okunabilir durumda kalır.

### Örnek 2

Bir kullanıcı kurs düzeltmesinden sonra gönderilen bir ajanı iptal edin.

```
TaskStop(task_id: "agent_01ABCD...")
```

## Notlar

- `TaskStop` sonlandırma talep eder; anlık kapanmayı garanti etmez. İyi davranan görevler hemen çıkar, ancak bloklayıcı I/O yapan bir süreç çözülmesi için biraz zaman alabilir.
- Bir görevi durdurmak çıktısını silmez. Arka plan kabuk görevleri için diskteki çıktı dosyası korunur ve hala `Read` ile okunabilir. Ajanlar ve oturumlar için, durdurmadan önce yakalanan herhangi bir çıktı hala `TaskOutput` aracılığıyla erişilebilir.
- Bilinmeyen bir `task_id` veya zaten bitmiş bir görev bir hata veya bir işlemsiz sonuç döndürür. Bu güvenlidir — önce durumu kontrol etmeden defansif olarak `TaskStop` çağırabilirsiniz.
- Aynı işi yeniden başlatmayı planlıyorsanız, paylaşılan kaynaklar (dosyalar, portlar, veritabanı satırları) üzerinde yarışan iki paralel çalışmayı önlemek için yenisini göndermeden önce eskisini durdurun.
- `TaskStop` ekip görev listesindeki girişleri etkilemez. İzlenen bir görevi iptal etmek için, durumunu `TaskUpdate` ile `deleted` olarak güncelleyin.
