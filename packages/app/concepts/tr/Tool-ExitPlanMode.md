# ExitPlanMode

Plan modu sırasında hazırlanan uygulama planını kullanıcı onayına gönderir ve — onaylanırsa — düzenlemelere başlanabilmesi için oturumu plan modundan çıkarır.

## Ne Zaman Kullanılır

- `EnterPlanMode` sırasında yazılan bir plan tamamlandı ve incelemeye hazır.
- Görev saf araştırma değil, uygulama odaklıdır (kod veya yapılandırma değişiklikleri), bu nedenle açık bir plan uygundur.
- Tüm ön okuma ve analiz yapıldı; kullanıcı karar vermeden önce daha fazla inceleme gerekmez.
- Asistan sadece hedefleri değil, somut dosya yollarını, fonksiyonları ve adımları numaralandırdı.
- Kullanıcı planı görmek istedi veya plan modu iş akışı düzenleme araçlarına devrediliyor.

## Parametreler

- `allowedPrompts` (dizi, opsiyonel): Kullanıcının onay ekranında planı otomatik olarak onaylamak veya değiştirmek için yazabileceği istemler. Her öğe kapsamlı bir izin belirtir (örneğin bir işlem adı ve uygulandığı araç). Varsayılan onay akışını kullanmak için ayarsız bırakın.

## Örnekler

### Örnek 1: Standart gönderme

Plan modunda bir kimlik doğrulama refactoring'ini inceledikten ve plan dosyasını diske yazdıktan sonra, asistan argümansız olarak `ExitPlanMode`'u çağırır. Harness, planı standart konumundan okur, kullanıcıya gösterir ve onay veya reddetme bekler.

### Örnek 2: Önceden onaylanmış hızlı eylemler

```
ExitPlanMode(allowedPrompts=[
  {"tool": "Bash", "prompt": "run tests"},
  {"tool": "Bash", "prompt": "install dependencies"}
])
```

Kullanıcının rutin takip komutları için önceden izin vermesine izin verir, böylece asistanın uygulama sırasında her izin istemi için duraklamasına gerek kalmaz.

## Notlar

- `ExitPlanMode` yalnızca uygulama tarzı iş için anlam taşır. Kullanıcının isteği dosya değişikliği olmayan bir araştırma veya açıklama görevi ise, doğrudan yanıt verin — sadece çıkmak için plan modundan geçmeyin.
- Bu aracı çağırmadan önce plan zaten diske yazılmış olmalıdır. `ExitPlanMode` plan gövdesini bir parametre olarak kabul etmez; harness'in beklediği yoldan okur.
- Kullanıcı planı reddederse, plan moduna dönersiniz. Geri bildirime dayalı olarak revize edin ve tekrar gönderin; plan onaylanmamışken dosyaları düzenlemeye başlamayın.
- Onay, plan modundan çıkma ve planda açıklanan kapsam için değiştirici araçları (`Edit`, `Write`, `Bash` vb.) kullanma iznini verir. Kapsamı sonradan genişletmek yeni bir plan veya açık kullanıcı onayı gerektirir.
- Bu aracı çağırmadan önce "bu plan iyi görünüyor mu?" diye sormak için `AskUserQuestion` kullanmayın — plan onayı istemek tam olarak `ExitPlanMode`'un yaptığı şeydir ve kullanıcı gönderilene kadar planı göremez.
- Planı minimal ve eyleme dönüştürülebilir tutun. Bir inceleyici bir dakikadan az sürede tarayabilmeli ve tam olarak neyin değişeceğini anlayabilmelidir.
- Uygulama ortasında planın yanlış olduğunu fark ederseniz, sessizce sapmak yerine durun ve kullanıcıya rapor verin. Plan moduna yeniden girmek geçerli bir sonraki adımdır.
