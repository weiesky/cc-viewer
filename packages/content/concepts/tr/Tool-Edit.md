# Edit

Var olan bir dosyanın içinde tam string değişimi gerçekleştirir. Dosyaları değiştirmek için tercih edilen yoldur çünkü yalnızca diff iletilir, bu da düzenlemeleri hassas ve denetlenebilir tutar.

## Ne Zaman Kullanılır

- Çevreleyen dosyayı yeniden yazmadan tek bir fonksiyondaki bir hatayı düzeltmek
- Bir yapılandırma değerini, sürüm string'ini veya içe aktarma yolunu güncellemek
- `replace_all` ile bir dosyada bir sembolü yeniden adlandırmak
- Bir çapa yakınına blok eklemek (`old_string`'i yakın bağlamı içerecek şekilde genişletin, sonra değiştirmeyi sağlayın)
- Çok adımlı bir refactoring'in parçası olarak küçük, iyi kapsamlı düzenlemeleri uygulamak

## Parametreler

- `file_path` (string, zorunlu): Değiştirilecek dosyanın mutlak yolu.
- `old_string` (string, zorunlu): Aranacak tam metin. Beyaz boşluk ve girinti dahil karakter karakter eşleşmelidir.
- `new_string` (string, zorunlu): Değiştirme metni. `old_string`'ten farklı olmalıdır.
- `replace_all` (boolean, opsiyonel): `true` olduğunda, `old_string`'in her örneğini değiştirir. Varsayılan `false`, bu da eşleşmenin benzersiz olmasını gerektirir.

## Örnekler

### Örnek 1: Tek bir çağrı yerini düzeltmek
`old_string`'i tam olarak `const port = 3000;` satırına ve `new_string`'i `const port = process.env.PORT ?? 3000;` olarak ayarlayın. Eşleşme benzersiz olduğundan `replace_all` varsayılanında kalabilir.

### Örnek 2: Bir dosyada bir sembolü yeniden adlandırmak
`api.ts`'de `getUser`'ı her yerde `fetchUser` olarak yeniden adlandırmak için `old_string: "getUser"`, `new_string: "fetchUser"` ve `replace_all: true` olarak ayarlayın.

### Örnek 3: Tekrarlanan bir parçacığın belirsizliğini gidermek
`return null;` birkaç dalda görünüyorsa, eşleşmenin benzersiz olması için `old_string`'i çevreleyen bağlamı (örneğin önceki `if` satırını) içerecek şekilde genişletin. Aksi takdirde araç tahmin etmek yerine hata verir.

## Notlar

- `Edit` değişiklikleri kabul etmeden önce mevcut oturumda dosyaya en az bir kez `Read` çağırmalısınız. `Read` çıktısındaki satır numarası önekleri dosya içeriğinin parçası değildir; bunları `old_string` veya `new_string`'e dahil etmeyin.
- Beyaz boşluk tam eşleşmelidir. Özellikle YAML, Makefile ve Python'da sekmelere karşı boşluklara ve sondaki boşluklara dikkat edin.
- `old_string` benzersiz değilse ve `replace_all` `false` ise düzenleme başarısız olur. Ya bağlamı genişletin ya da `replace_all`'i etkinleştirin.
- Dosya zaten varsa `Edit`'i `Write`'a tercih edin; `Write` tüm dosyanın üzerine yazar ve dikkatli değilseniz ilgisiz içeriği kaybedersiniz.
- Aynı dosyada birden fazla ilgisiz düzenleme için, tek bir büyük, kırılgan değişiklik yerine sırayla birkaç `Edit` çağrısı yayınlayın.
- Kaynak dosyalarını düzenlerken emoji, pazarlama yazısı veya istenmeyen belge blokları eklemekten kaçının.
