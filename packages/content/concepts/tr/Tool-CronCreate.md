# CronCreate

Bir prompt'u gelecekteki belirli bir zamanda kuyruğa almak için zamanlama yapar; tek seferlik hatırlatıcılar ve tekrarlayan görevler için kullanılır. Kullanıcının yerel saat dilimine göre standart 5 alanlı cron sözdizimini kullanır — saat dilimi dönüşümü gerekmez.

## Ne Zaman Kullanılır

- **Tek seferlik hatırlatıcılar**: Kullanıcının belirli bir saatte hatırlatılmak istediği durumlarda ("yarın saat 15:00'te hatırlat"). `recurring: false` ile görev çalıştıktan sonra otomatik olarak silinir.
- **Tekrarlayan zamanlamalar**: Bir şeyin düzenli olarak gerçekleşmesi gerektiğinde ("her hafta içi sabah 9'da", "her 30 dakikada"). Varsayılan `recurring: true` bu durumu karşılar.
- **Otonom ajan döngüleri**: Günlük özetler veya periyodik durum kontrolleri gibi kendini yeniden tetikleyen iş akışları oluşturmak için.
- **Kalıcı görevler**: Zamanlamanın oturum yeniden başlatmalarından sağ çıkması gerektiğinde. `durable: true` geçirerek görev `.claude/scheduled_tasks.json` dosyasına kaydedilir.
- **Yaklaşık zaman istekleri**: Kullanıcı "sabah 9 civarı" veya "saatlik" dediğinde, :00 veya :30'da yoğunlaşmayı önlemek için kaydırılmış bir dakika değeri seçin (örn. `57 8 * * *` veya `7 * * * *`).

## Parametreler

- `cron` (string, zorunlu): Kullanıcının yerel saat dilimine göre 5 alanlı cron ifadesi. Format: `dakika saat ayın-günü ay haftanın-günü`. Örnek: `"0 9 * * 1-5"` Pazartesi–Cuma sabah 9:00 anlamına gelir.
- `prompt` (string, zorunlu): Cron tetiklendiğinde kuyruğa alınacak prompt metni — zamanlanan saatte REPL'e gönderilecek tam mesaj.
- `recurring` (boolean, isteğe bağlı, varsayılan `true`): `true` olduğunda iş her eşleşen cron aralığında çalışır ve 7 gün sonra otomatik olarak sona erer. `false` olduğunda iş tam olarak bir kez çalışır ve silinir — tek seferlik hatırlatıcılar için kullanılır.
- `durable` (boolean, isteğe bağlı, varsayılan `false`): `false` olduğunda zamanlama yalnızca bellekte yaşar ve oturum bittiğinde kaybolur. `true` olduğunda görev `.claude/scheduled_tasks.json` dosyasına kaydedilir ve yeniden başlatmalardan sağ çıkar.

## Örnekler

### Örnek 1: tek seferlik hatırlatıcı

Kullanıcı şunu söylüyor: "Yarın saat 14:30'da haftalık raporu göndermemi hatırlat." Yarının 21 Nisan olduğunu varsayalım:

```json
{
  "cron": "30 14 21 4 *",
  "prompt": "Hatırlatıcı: haftalık raporu şimdi gönder.",
  "recurring": false,
  "durable": true
}
```

`recurring: false` görevin çalıştıktan sonra kendini silmesini sağlar. `durable: true` ise önceki yeniden başlatmalarda da korunmasını garantiler.

### Örnek 2: tekrarlayan hafta içi sabah görevi

Kullanıcı şunu söylüyor: "Her hafta içi sabahı açık GitHub sorunlarımı özetle."

```json
{
  "cron": "3 9 * * 1-5",
  "prompt": "Bana atanmış tüm açık GitHub sorunlarını özetle.",
  "recurring": true,
  "durable": true
}
```

`0` yerine `3` dakikası, tam saatteki yük zirvesini önler. Görev 7 gün sonra otomatik olarak sona erer.

## Notlar

- **7 günlük otomatik süre sonu**: Tekrarlayan görevler en fazla 7 gün sonra otomatik olarak silinir. Daha uzun bir zamanlama gerekiyorsa görevi süresi dolmadan yeniden oluşturun.
- **Yalnızca boştayken tetiklenir**: `CronCreate`, prompt'u yalnızca REPL başka bir sorguyu işlemediğinde kuyruğa ekler. Tetikleme anında REPL meşgulse prompt, mevcut sorgu tamamlanana kadar bekler.
- **:00 ve :30 dakikalarından kaçının**: Yaklaşık zaman istekleri için sistem yükünü dağıtmak amacıyla bilinçli olarak kaydırılmış dakika değerleri seçin. :00/:30'u yalnızca kullanıcı o dakikayı açıkça belirttiğinde kullanın.
- **Saat dilimi dönüşümü gerekmez**: Cron ifadesi, kullanıcının yerel saat dilimine göre doğrudan yorumlanır. UTC'ye veya başka bir dilime dönüştürme gerekmez.
