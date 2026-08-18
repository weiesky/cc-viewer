# ScheduleWakeup

`/loop` dinamik modunda çalışmanın ne zaman devam edeceğini zamanlar. Bu araç, Claude'un seçilen aralık boyunca uyuyarak ve ardından aynı döngü istemiyle yeniden tetiklenerek görev yinelemelerinin temposunu özerk biçimde yönetmesine olanak tanır.

## Ne Zaman Kullanılır

- Yineleme aralığının sabit bir saate değil, çalışma durumuna bağlı olduğu `/loop` dinamik görevlerinde tempoyu özerk biçimde yönetmek için
- Sonuçları kontrol etmeden önce uzun bir derleme, dağıtım veya test çalıştırmasının tamamlanmasını beklemek için
- Şu anda izlenecek belirli bir sinyal olmadığında yinelemeler arasına boşta tik eklemek için
- Kullanıcı istemi olmadan özerk bir döngü çalıştırmak için — `prompt` olarak değişmez sentinel `<<autonomous-loop-dynamic>>` geçirin
- Durumu yakında değişecek bir süreci yoklamak için (önbelleği sıcak tutmak üzere kısa bir gecikme kullanın)

## Etkinleştirme

- Amazon Bedrock, AWS üzerinde Claude Platform, Google Cloud Agent Platform veya Microsoft Foundry'de kullanılamaz.
- Ayrıca özellik bayrağı getirme devre dışıyken kapalıdır (telemetri/trafik ortam değişkenleri).

## Parametreler

- `delaySeconds` (sayı, gerekli): Devam edene kadar geçecek saniye sayısı. Çalışma zamanı değeri otomatik olarak `[60, 3600]` ile sınırlandırır; bu nedenle manuel sınırlandırma gerekmez.
- `reason` (dize, gerekli): Seçilen gecikmeyi açıklayan kısa bir cümle. Kullanıcıya gösterilir ve telemetride kaydedilir. Somut olun — "uzun bun derlemesi kontrol ediliyor" "bekleniyor" ifadesinden daha kullanışlıdır.
- `prompt` (dize, gerekli): Uyanışta tetiklenecek `/loop` girdisi. Sonraki tetiklemenin görevi tekrarlaması için her turda aynı dizeyi geçirin. Kullanıcı istemi olmayan özerk bir döngü için değişmez sentinel `<<autonomous-loop-dynamic>>` geçirin.

## Örnekler

### Örnek 1: hızla değişen bir sinyali yeniden kontrol etmek için kısa gecikme (önbelleği sıcak tutun)

Derleme yeni başlatıldı ve genellikle iki ila üç dakikada tamamlanıyor.

```json
{
  "delaySeconds": 120,
  "reason": "~2 dakikada tamamlanması beklenen bun derlemesi kontrol ediliyor",
  "prompt": "derleme durumunu kontrol et ve hataları raporla"
}
```

120 saniye, konuşma bağlamını Anthropic istem önbelleğinde tutar (TTL 5 dk), bu nedenle sonraki uyanış daha hızlı ve daha ucuzdur.

### Örnek 2: uzun boşta tik (önbellek kaçırmasını kabul et, daha uzun bekleme süresine yay)

Bir veritabanı geçişi çalışıyor ve genellikle 20–40 dakika sürüyor.

```json
{
  "delaySeconds": 1200,
  "reason": "geçiş genellikle 20–40 dk sürer; 20 dk sonra tekrar kontrol",
  "prompt": "geçiş durumunu kontrol et ve tamamlandıysa devam et"
}
```

Uyanışta önbellek soğuk olacak, ancak 20 dakikalık bekleme tek bir önbellek kaçırmasının maliyetini fazlasıyla karşılar. Her 5 dakikada bir yoklama yapmak, hiçbir fayda sağlamadan aynı kaçırma maliyetini 4 kez ödeyecektir.

## Notlar

- **5 dakikalık önbellek TTL'si**: Anthropic istem önbelleği 300 saniye sonra sona erer. 300 saniyenin altındaki gecikmeler bağlamı sıcak tutar; 300 saniyenin üzerindeki gecikmeler sonraki uyanışta önbellek kaçırmasına neden olur.
- **Tam olarak 300 saniyeden kaçının**: Bu her iki dünyanın da en kötüsüdür — anlamlı biçimde daha uzun bir bekleme süresi elde etmeden önbellek kaçırması maliyetini ödersiniz. Ya 270 saniyeye düşürün (önbelleği sıcak tutun) ya da 1200 saniye veya daha fazlasına commit yapın (tek bir kaçırma çok daha uzun bir bekleme süresi satın alır).
- **Boşta tikler için varsayılan**: İzlenecek belirli bir sinyal olmadığında **1200–1800 saniye** (20–30 dk) kullanın. Bu, döngünün periyodik olarak kontrol etmesini sağlarken önbelleği hiçbir neden olmaksızın saatte 12 kez yakmaz.
- **Otomatik sınırlandırma**: Çalışma zamanı `delaySeconds` değerini `[60, 3600]` ile sınırlandırır. 60'ın altındaki değerler 60 olur; 3600'ün üzerindeki değerler 3600 olur. Bu sınırları kendiniz yönetmeniz gerekmez.
- **Döngüyü sonlandırmak için çağrıyı atlayın**: Yinelemeleri durdurmak istiyorsanız ScheduleWakeup'ı çağırmayın. Çağrıyı atlamak döngüyü sonlandırır.
- **Her turda aynı `prompt`'u geçin**: `prompt` alanı, sonraki uyanışın hangi göreve devam edeceğini bilmesi için her çağrıda orijinal `/loop` talimatını taşımalıdır.
