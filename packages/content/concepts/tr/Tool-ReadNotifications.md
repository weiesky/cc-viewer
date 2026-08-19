# ReadNotifications

Mevcut oturumda asistan için kuyruğa alınan bildirimleri okur — abone olunan PR'lardaki GitHub etkinliği (`github_webhook`), zamanlanmış tetikleyici ateşlemeleri (`trigger_fire`) ve diğer Claude oturumlarından gelen mesajlar (`mcp_send_message`).

## Ne Zaman Kullanılır

- Bir şey olduğuna dair bilgilendirildiniz — abone olunan bir PR güncellendi, zamanlanmış bir tetikleyici ateşlendi, başka bir oturum size mesaj gönderdi — ve gerçek veri yüküne ihtiyacınız var.
- Bir birikimi boşaltma: büyük gruplar parçalar hâlinde döndürülür, bu yüzden sonuç 0 `remaining` bildirene kadar çağırmaya devam edin.

## Parametreler

Bu araç parametre almaz.

## Örnekler

### Örnek 1: Bekleyen bildirimleri boşaltmak

```
ReadNotifications()
```

Kuyruğa alınan bildirimleri en eskiden başlayarak döndürür. Sonuç, bu boşaltmadan sonra hâlâ kuyrukta olan bildirimlerin `remaining` sayısını içerir — bunları okumak için aracı tekrar çağırın.

## Notlar

- Boşaltmalar boyut bütçelidir: bir takip çağrısı AYNI kuyruğun geri kalanını (artı yeni gelenleri) döndürür, yalnızca yeni gelenleri değil. `remaining` 0 olana kadar döngü yapın.
- Bildirimler abone olunan PR'lardaki GitHub webhook'larından, zamanlanmış tetikleyicilerden ve diğer Claude oturumlarından gelen mesajlardan kaynaklanır; mevcut sürümde filtreleme parametresi yoktur.
