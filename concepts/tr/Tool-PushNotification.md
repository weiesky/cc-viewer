# PushNotification

Geçerli Claude Code oturumundan masaüstü bildirimi gönderir. Remote Control bağlıysa bildirim kullanıcının telefonuna da iletilir ve ne yapıyor olurlarsa olsunlar dikkatlerini oturuma geri çeker.

## Ne Zaman Kullanılır

- Kullanıcı muhtemelen terminalden uzaktayken uzun süreli bir görev tamamlandığında
- Bir derleme, test çalıştırması veya dağıtım tamamlandığında ve sonuç incelemeye hazır olduğunda
- Devam etmeden önce kullanıcı girdisi gerektiren bir karar noktasına ulaşıldığında
- Özerk olarak çözülemeyen bir hata veya engelleyici ortaya çıktığında
- Kullanıcı belirli bir görev veya koşul karşılandığında bildirim almak istediğini açıkça belirttiğinde

## Ne Zaman Kullanılmaz

Görev sırasında rutin ilerleme güncellemeleri için ya da kullanıcının açıkça yeni sorduğu ve beklediği bir soruyu cevapladığınızı onaylamak için bildirim göndermeyin. Kısa bir görev tamamlandığında bildirim göndermeyin — kullanıcı görevi yeni göndermiş ve bekliyorsa bildirim bir değer katmaz ve gelecekteki bildirimlere olan güveni zayıflatır. Kesinlikle göndermeme yönünde eğilin.

## Etkinleştirme

- Varsayılan olarak kapalıdır (sunucu tarafı bir özellik bayrağı).
- Teslimat Anthropic tarafından barındırılan altyapı üzerinden çalışır — Amazon Bedrock, AWS üzerinde Claude Platform, Google Cloud veya Microsoft Foundry'de kullanılamaz.
- Telefona push ayrıca bağlı bir Remote Control istemcisi gerektirir.

## Parametreler

- `message` (dize, zorunlu): bildirim gövdesi. 200 karakterin altında tutun; mobil işletim sistemleri daha uzun dizeleri keser. Kullanıcının harekete geçeceği içerikle başlayın: "build failed: 2 auth tests", "task complete" ifadesinden çok daha kullanışlıdır.
- `status` (dize, zorunlu): her zaman `"proactive"` olarak ayarlayın. Bu sabit bir işaretleyicidir ve değişmez.

## Örnekler

### Örnek 1: Uzun bir analizin tamamlanmasında bildirim gönderme

Depo genelinde bir bağımlılık denetimi talep edildi ve çalışması birkaç dakika sürdü. Kullanıcı uzaklaştı. Rapor hazır olduğunda:

```
message: "Bağımlılık denetimi tamamlandı: lodash, axios, jsonwebtoken'da 3 yüksek öncelikli CVE bulundu. Rapor: audit-report.txt"
status: "proactive"
```

### Örnek 2: Özerk çalışma sırasında karar noktasını işaretleme

Çok adımlı bir yeniden yapılandırma sırasında iki modülün çakışan arayüzlere sahip olduğu ve tasarım kararı alınmadan birleştirilemeyeceği keşfedilir:

```
message: "Yeniden yapılandırma durduruldu: AuthService ve UserService'in çakışan token arayüzleri var. Devam etmeden önce kararınız gerekiyor."
status: "proactive"
```

## Notlar

- Kesinlikle **göndermeme** yönünde eğilin. Bildirim, kullanıcının ne yaptığından bağımsız olarak onları kesintiye uğratır. Bunu, bilginin değeriyle gerekçelendirilmesi gereken bir maliyet olarak değerlendirin.
- Harekete geçirilebilir içerikle başlayın. İlk kelimeler kullanıcıya ne olduğunu ve varsa ne yapmaları gerektiğini söylemelidir — genel bir durum etiketi değil.
- `message`'ı 200 karakterin altında tutun. Mobil işletim sistemleri daha uzun dizeleri keser ve en önemli kısım sonda yer alıyorsa onu çıkarabilir.
- Sonuç, Remote Control bağlı olmadığı için push gönderilmediğini gösteriyorsa bu beklenen bir davranıştır. Yeniden deneme veya ek işlem gerekmez; yerel masaüstü bildirimi yine de tetiklenir.
- Bildirim israfından kaçının. Küçük olaylar için sık sık bildirim gönderilirse kullanıcı bunları görmezden gelmeye başlar. Bu aracı, kullanıcının uzaklaştığına dair gerçek bir olasılık olduğu ve sonucu şimdi öğrenmek isteyeceği anlara saklayın.
