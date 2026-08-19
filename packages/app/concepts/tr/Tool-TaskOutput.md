# TaskOutput

Çalışan veya tamamlanmış bir arka plan görevinin — bir arka plan kabuk komutunun, yerel bir ajanın veya uzak bir oturumun — birikmiş çıktısını getirir. Uzun süredir çalışan bir görevin o ana kadar ürettiklerini incelemeniz gerektiğinde kullanın.

## Ne Zaman Kullanılır

- Uzak bir oturum (örneğin bir bulut sandbox'ı) çalışıyor ve stdout'una ihtiyacınız var.
- Yerel bir ajan arka planda gönderildi ve geri dönmeden önce kısmi ilerleme görmek istiyorsunuz.
- Bir arka plan kabuk komutu, durdurmadan kontrol etmek isteyeceğiniz kadar uzun süre çalışıyor.
- Arka plan görevinin gerçekten ilerleme kaydettiğini daha uzun beklemeden veya `TaskStop` çağırmadan önce doğrulamanız gerekiyor.

`TaskOutput`'a refleksle uzanmayın. Çoğu arka plan işi için daha doğrudan bir yol vardır — aşağıdaki notlara bakın.

## Parametreler

- `task_id` (string, zorunlu): Arka plan işi başlatıldığında döndürülen görev tanımlayıcısı. Bir task-list `taskId` ile aynı değildir; bu belirli yürütme için çalışma zamanı handle'ıdır.
- `block` (boolean, opsiyonel): `true` (varsayılan) olduğunda, görev yeni çıktı üretene veya tamamlanana kadar geri dönmeden önce bekler. `false` olduğunda, arabellekte ne varsa hemen geri döner.
- `timeout` (number, opsiyonel): Geri dönmeden önce beklenecek maksimum milisaniye. Yalnızca `block` `true` olduğunda anlamlıdır. Varsayılan `30000`, maksimum `600000`.

## Örnekler

### Örnek 1

Bloklamadan uzak bir oturuma bakın.

```
TaskOutput(task_id: "sess_01HXYZ...", block: false)
```

Görev başladığından beri (veya çalışma zamanına bağlı olarak son `TaskOutput` çağrınızdan beri) üretilen stdout/stderr'yi döndürür.

### Örnek 2

Yerel bir ajanın daha fazla çıktı yayması için kısaca bekleyin.

```
TaskOutput(
  task_id: "agent_01ABCD...",
  block: true,
  timeout: 10000
)
```

## Notlar

- Arka plan bash komutları: `TaskOutput` bu kullanım senaryosu için etkin bir şekilde kullanımdan kaldırılmıştır. Arka plan kabuk görevi başlattığınızda, sonuç zaten çıktı dosyasının yolunu içerir — bu yolu doğrudan `Read` aracıyla okuyun. `Read` size rastgele erişim, satır ofsetleri ve kararlı bir görünüm verir; `TaskOutput` vermez.
- Yerel ajanlar (arka planda gönderilen `Agent` aracı): ajan bittiğinde, `Agent` aracı sonucu zaten nihai yanıtını içerir. Bunu doğrudan kullanın. Sembolik bağlanmış transcript dosyasını `Read` etmeyin — tam araç çağrı akışını içerir ve bağlam penceresini taşırır.
- Uzak oturumlar: `TaskOutput`, çıktıyı geri akışla almanın doğru ve genellikle tek yoludur. Sıkı yoklama döngüleri yerine mütevazı bir `timeout` ile `block: true` tercih edin.
- Bilinmeyen bir `task_id` veya çıktısı çöp toplanmış bir görev hata döndürür. Hala ihtiyaç varsa işi yeniden gönderin.
- `TaskOutput` görevi durdurmaz. Sonlandırmak için `TaskStop` kullanın.
