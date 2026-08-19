# CronList

Gecerli oturumda `CronCreate` araciligiyla zamanlanmis tum cron islerini listeler. Her aktif cronun `id`, cron ifadesi, kisaltilmis `prompt`, `recurring` bayragi, `durable` bayragi ve bir sonraki calisma zamanini iceren bir ozet dondurur.

## Ne Zaman Kullanilir

- Degisiklik yapmadan veya oturumu sonlandirmadan once tum zamanlanmis isleri denetlemek icin.
- Bir isi silmek uzere `CronDelete` cagrilmadan once dogru `id`yi bulmak icin.
- Beklenen bir isin neden hic calismadigini, varligini dogrulamak ve bir sonraki calisma zamanini kontrol etmek suretiyle hata ayiklamak icin.
- Tek seferlik (tekrar etmeyen) bir isin henuz calismadigini ve hala beklemede oldugunu dogrulamak icin.

## Parametreler

Yok.

## Ornekler

### Ornek 1: tum zamanlanmis isleri denetle

Tum aktif cron islerinin tam listesini almak icin `CronList`i argumansiz cagirim. Yanit; her is icin `id`yi, zamanlamasini tanimlayan cron ifadesini, calistirilacak `prompt`un kisaltilmis bir surumuniu, `recurring` (tekrar eden) olup olmadigini, `durable` (yeniden baslatmalar arasinda kalici) olup olmadigini ve bir sonraki planlanmis calisma zamanini icerir.

### Ornek 2: belirli bir tekrarlanan gorev icin id bul

Birden fazla cron isi olusturulduysa ve bunlardan belirli bir tekrar eden is silinmesi gerekiyorsa, once `CronList` cagir. Kaldirilmak istenen gorevle eslesecek `prompt` ozetine ve cron ifadesine sahip isi bulmak icin dondurulmus listeyi tara. `id`yi kopyala ve `CronDelete`e ilet.

## Notlar

- Yalnizca gecerli oturumda olusturulan isler listelenir; `durable: true` ile olusturulanlar bunun istisnasini olusturur, bu isler oturum yeniden baslatmalari arasinda kalici olabilir.
- Ozetin `prompt` alani kisaltilmistir; tam prompt metninin yalnizca basini gosterir, tum icerigi gostermez.
- Zaten tetiklenip calistirilan tek seferlik isler (`recurring` degeri `false`), otomatik olarak silinir ve artik listede gorunmez.
