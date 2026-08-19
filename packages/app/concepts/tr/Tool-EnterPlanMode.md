# EnterPlanMode

Oturumu plan moduna geçirir; bu, asistanın kod tabanını incelediği ve herhangi bir dosya değiştirilmeden önce kullanıcının onayı için somut bir uygulama planı hazırladığı yalnızca-okuma keşif aşamasıdır.

## Ne Zaman Kullanılır

- Kullanıcı birden fazla dosya veya alt sistemi kapsayan önemsiz olmayan bir değişiklik ister.
- Gereksinimler belirsizdir ve asistanın bir yaklaşıma bağlanmadan önce kodu okuması gerekir.
- Bir refactoring, geçiş veya bağımlılık yükseltmesi önerilir ve etki yarıçapı belirsizdir.
- Kullanıcı açıkça "bunu planla", "önce planlayalım" diyor veya tasarım incelemesi talep ediyor.
- Risk, doğrudan düzenlemelere geçmek çalışmayı boşa çıkarabilecek veya durumu bozabilecek kadar yüksektir.

## Parametreler

Yok. `EnterPlanMode` hiçbir argüman almaz — boş bir parametre nesnesiyle çağırın.

## Örnekler

### Örnek 1: Büyük özellik isteği

Kullanıcı sorar: "Yönetici paneline Okta üzerinden SSO ekle." Asistan `EnterPlanMode`'u çağırır, sonra birkaç tur kimlik doğrulama middleware'ini, oturum depolamasını, yönlendirme korumalarını ve mevcut giriş arayüzünü okumakla geçirir. Gerekli değişiklikleri, geçiş adımlarını ve test kapsamını açıklayan bir plan yazar, sonra onay için `ExitPlanMode` aracılığıyla gönderir.

### Örnek 2: Riskli refactoring

Kullanıcı der ki: "REST denetleyicilerini tRPC'ye dönüştür." Asistan plan moduna girer, her denetleyiciyi inceler, genel sözleşmeyi kataloglar, yayın aşamalarını (shim, çift okuma, geçiş) listeler ve herhangi bir dosyaya dokunmadan önce bir sıralama planı önerir.

## Notlar

- Plan modu sözleşme gereği yalnızca-okumadır. İçindeyken asistan `Edit`, `Write`, `NotebookEdit` veya herhangi bir değiştirici kabuk komutu çalıştırmamalıdır. Yalnızca `Read`, `Grep`, `Glob` ve yıkıcı olmayan `Bash` komutları kullanın.
- Önemsiz tek satırlık düzenlemeler, saf araştırma soruları veya kullanıcının değişikliği tam ayrıntısıyla zaten belirttiği görevler için plan moduna girmeyin. Ek yük, yararından daha çok zarar verir.
- Otomatik modda, kullanıcı açıkça talep etmedikçe plan modu önerilmez — Otomatik mod, önceden planlamaktan ziyade eylemi tercih eder.
- Pahalı işlerde kurs düzeltmelerini azaltmak için plan modunu kullanın. Beş dakikalık bir plan genellikle yanlış yönlendirilmiş düzenlemelerde bir saat tasarruf sağlar.
- Plan modunda bir kez girdikten sonra, araştırmayı gerçekten değişecek sistem parçalarına odaklayın. Eldeki görevle ilgisi olmayan deponun kapsamlı turlarından kaçının.
- Planın kendisi, `ExitPlanMode`'un onu gönderebilmesi için harness'in beklediği yolda diske yazılmalıdır. Plan, belirsiz niyet değil, somut dosya yolları, fonksiyon adları ve doğrulama adımları içermelidir.
- Kullanıcı planı reddedip revizyon isteyebilir. Plan kabul edilene kadar plan modunda iterasyon yapın; ancak o zaman çıkın.
