# ListAgents

`SendMessage` gönderebileceğiniz agent'ları listeler: oluşturduğunuz süreç içi alt agent'lar, bu makinedeki diğer yerel Claude oturumları, bulut oturumlarınız (bu oturumun bulut erişimi varsa) ve — Remote Control bağlıyken — hesabınızın diğer oturumları. Her satır türüne göre etiketlenir.

## Ne Zaman Kullanılır

- Mesaj göndermeden önce bir eş oturumun veya alt agent'ın tam adına ihtiyacınız var.
- Şu anda bu oturumdan hangi oturumlara erişilebildiğini görmek istiyorsunuz.

## Parametreler

- `channel` (string, opsiyonel): Bu derlemede mevcut değil; ayarlanmadan bırakın.
- `q` (string, opsiyonel): Bu derlemede mevcut değil; ayarlanmadan bırakın.

## Örnekler

### Örnek 1: Erişilebilir agent'ları listeleme

```
ListAgents()
```

Her satır bir ad yazdırır — o ad adrestir. Adı aynen yazdırıldığı gibi kopyalayarak `SendMessage({to: "<name>", message: "..."})` ile gönderin. Bir satırın ` [ref]` ekini yalnızca çıplak ad belirsiz olduğunda ekleyin (iki satır aynı adı paylaşıyorsa veya bir hata sizden ayrıştırma istiyorsa).

## Notlar

- Salt okunur ve eşzamanlılık açısından güvenli.
- Bir bulut oturumu mesajınızı alır ancak henüz yanıt mesajı gönderemez — yanıtını kendi transkriptinde okuyun.
- Kullanılabilirlik oturum yapılandırmasına bağlıdır (oturumlar arası mesajlaşma kısıtlı bir özelliktir).
