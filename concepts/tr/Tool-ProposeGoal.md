# ProposeGoal

Oturum için doğrulanabilir bir tamamlama hedefi önerir. Hedef (varsayılan olarak) bir onay iletişim kutusunda kullanıcıya gösterilir ve bir kez belirlendiğinde konuşmanın geri kalanını kontrol edilebilir bir sonuca yönlendirir.

## Ne Zaman Kullanılır

- Oturumun, bir değerlendiricinin konuşmadan doğrulayabileceği somut bir bitiş durumu vardır (ör. "all tests in test/auth pass").
- Önemli miktarda iş yapmadan önce kullanıcının "bitti"nin ne anlama geldiğine ilişkin açık onayını istiyorsunuz.
- Kullanıcının kendi sözleri sonucu zaten ifade etmiştir ve bunun oturum hedefi olarak kaydedilmesini istiyorsunuz.

## Parametreler

- `condition` (string, zorunlu): Tamamlama koşulu; ayrı bir değerlendiricinin konuşmadan doğrulayabileceği şekilde yazılır (ör. "all tests in test/auth pass (bun test exits 0)"). En fazla 500 karakter — kullanıcı koşulun tamamını onay iletişim kutusunda okuyabilmelidir.
- `ask_user` (mantıksal, opsiyonel): Hedef belirlenmeden önce kullanıcıdan onay istenip istenmeyeceği. Varsayılan true'dur (bir onay iletişim kutusu gösterilir). YALNIZCA kullanıcının bu konuşmadaki kendi sözleri bu sonucu istediği şey olarak ifade ettiyse false olarak ayarlayın; hedef daha sonra görünür bir bildirimle doğrudan belirlenir ve kullanıcı `/goal clear` ile temizleyebilir.

## Örnekler

### Örnek 1: Test destekli bir hedef önermek

```
ProposeGoal(condition="npm run test exits 0 with the new catalog cases included")
```

Kullanıcı koşulu bir onay iletişim kutusunda görür ve kabul edebilir, düzenleyebilir veya reddedebilir.

### Örnek 2: Kullanıcının ifade ettiği sonucu doğrudan benimsemek

```
ProposeGoal(condition="the login form validates email format and shows an inline error", ask_user=false)
```

Yalnızca kullanıcı bu sonucu konuşmanın başlarında açıkça ifade ettiği için geçerlidir.

## Notlar

- `condition`'ı kısa ve nesnel olarak kontrol edilebilir tutun — belirsiz hedefler ("make it better") amacı boşa çıkarır.
- `ask_user=false` kesinlikle kullanıcının kendisinin ifade ettiği sonuçlarla sınırlıdır; bunun dışındaki her şey onay iletişim kutusundan geçmelidir.
