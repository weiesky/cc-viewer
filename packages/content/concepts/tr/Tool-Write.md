# Write

Yerel dosya sisteminde yeni bir dosya oluşturur veya var olan bir dosyanın içeriklerini tamamen değiştirir. Hedef yoldaki her şeyi değiştirdiğinden, gerçek oluşturma veya kasıtlı tam yeniden yazma için saklanmalıdır.

## Ne Zaman Kullanılır

- Henüz var olmayan yepyeni bir kaynak dosyası, test veya yapılandırma oluşturmak
- Sıfırdan yeni bir fikstür, anlık görüntü veya veri dosyası üretmek
- Artımlı bir `Edit`'in yeniden başlamaktan daha karmaşık olacağı tam bir yeniden yazma gerçekleştirmek
- Kullanıcının açıkça üretmenizi istediği bir şema, geçiş veya derleme betiği gibi istenen bir eser yayınlamak

## Parametreler

- `file_path` (string, zorunlu): Yazılacak dosyanın mutlak yolu. Herhangi bir üst dizin zaten var olmalıdır.
- `content` (string, zorunlu): Dosyaya yazılacak tam metin. Bu, tüm dosya gövdesi olur.

## Örnekler

### Örnek 1: Yeni bir yardımcı modül oluşturun
`file_path: "/Users/me/app/src/utils/slugify.ts"` ile `Write` çağırın ve uygulamayı `content` olarak sağlayın. Bunu yalnızca dosyanın zaten var olmadığını doğruladıktan sonra kullanın.

### Örnek 2: Türetilmiş bir eseri yeniden oluşturun
Şema kaynağı değiştikten sonra, `/Users/me/app/generated/schema.json`'u taze üretilen JSON'u `content` olarak kullanarak tek bir `Write` çağrısında yeniden yazın.

### Örnek 3: Küçük bir fikstür dosyasını değiştirin
Her satırın değiştiği tek kullanımlık bir test fikstürü için, `Write` bir `Edit` çağrıları dizisinden daha net olabilir. Dosyayı önce okuyun, kapsamı onaylayın, sonra üzerine yazın.

## Notlar

- Var olan bir dosyanın üzerine yazmadan önce, mevcut oturumda üzerinde `Read` çağırmalısınız. `Write` görülmemiş içeriği bozmayı reddeder.
- Dosyanın yalnızca bir kısmına dokunan herhangi bir değişiklik için `Edit`'i tercih edin. `Edit` yalnızca diff'i gönderir, bu da daha hızlı, daha güvenli ve gözden geçirmesi daha kolaydır.
- Kullanıcı açıkça istemedikçe proaktif olarak Markdown dokümantasyonu, `README.md` veya changelog dosyaları oluşturmayın.
- Kullanıcı bu stili talep etmedikçe emoji, pazarlama yazısı veya dekoratif bannerlar eklemeyin.
- Önce `Bash` `ls` çağrısı ile üst dizinin var olduğunu doğrulayın; `Write` ara klasörler oluşturmaz.
- İçeriği tam olarak kalıcılaştırmak istediğiniz gibi sağlayın; şablonlama veya son işleme yoktur.
