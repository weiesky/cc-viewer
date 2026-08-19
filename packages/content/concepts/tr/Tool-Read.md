# Read

Yerel dosya sisteminden tek bir dosyanın içeriğini yükler. Düz metin, kaynak kodu, görüntüler, PDF'ler ve Jupyter notebook'larını destekler ve sonuçları `cat -n` stilinde 1 tabanlı satır numaralarıyla döndürür.

## Ne Zaman Kullanılır

- Düzenleme veya analiz öncesinde bilinen bir yoldaki bir kaynak dosyasını okumak
- Yapılandırma dosyalarını, lockfile'ları, günlükleri veya üretilen eserleri incelemek
- Kullanıcının konuşmaya yapıştırdığı ekran görüntülerini veya diyagramları görüntülemek
- Uzun bir PDF kılavuzundan belirli bir sayfa aralığını çıkarmak
- Kod hücrelerini, markdown'u ve hücre çıktılarını birlikte gözden geçirmek için bir `.ipynb` notebook'unu açmak

## Parametreler

- `file_path` (string, zorunlu): Hedef dosyanın mutlak yolu. Göreceli yollar reddedilir.
- `offset` (integer, opsiyonel): Okumaya başlanacak 1 tabanlı satır numarası. `limit` ile eşleştirildiğinde büyük dosyalar için kullanışlıdır.
- `limit` (integer, opsiyonel): `offset`'ten başlayarak döndürülecek maksimum satır sayısı. Atlandığında dosyanın üstünden varsayılan olarak 2000 satır.
- `pages` (string, opsiyonel): PDF dosyaları için sayfa aralığı, örneğin `"1-5"`, `"3"` veya `"10-20"`. 10 sayfadan uzun PDF'ler için gereklidir; istek başına maksimum 20 sayfa.

## Örnekler

### Örnek 1: Küçük bir dosyanın tamamını okumak
`Read`'i yalnızca `file_path` `/Users/me/project/src/index.ts` olarak ayarlanmış şekilde çağırın. Satır numaralarıyla birlikte 2000 satıra kadar döndürülür, bu genellikle düzenleme bağlamı için yeterlidir.

### Örnek 2: Uzun bir günlüğü sayfa sayfa görüntülemek
Bağlam tokenlarını israf etmeden dar bir pencere almak için birkaç bin satırlık bir günlük dosyasında `offset: 5001` ve `limit: 500` kullanın.

### Örnek 3: Belirli PDF sayfalarını çıkarmak
`/tmp/spec.pdf`'teki 120 sayfalık bir PDF için, yalnızca ihtiyacınız olan bölümü almak için `pages: "8-15"` ayarlayın. Büyük bir PDF'de `pages`'i atlamak hata üretir.

### Örnek 4: Bir görüntü görüntülemek
PNG veya JPG ekran görüntüsünün mutlak yolunu geçirin. Görüntü görsel olarak işlenir, böylece Claude Code onun üzerinde doğrudan akıl yürütebilir.

## Notlar

- Her zaman mutlak yolları tercih edin. Kullanıcı bir tane sağlıyorsa, olduğu gibi güvenin.
- 2000 karakterden uzun satırlar kesilir; aşırı geniş veriler için döndürülen içeriği olası kırpılmış olarak değerlendirin.
- Birden fazla bağımsız dosya okuyor musunuz? Paralel çalışmaları için aynı yanıtta birkaç `Read` çağrısı yayınlayın.
- `Read` dizinleri listeleyemez. Bunun yerine `Bash` `ls` çağrısı veya `Glob` aracı kullanın.
- Var olan ancak boş bir dosyayı okumak dosya baytları yerine bir sistem hatırlatıcısı döndürür, bu yüzden bu sinyali açıkça yönetin.
- Mevcut oturumda aynı dosyada `Edit` kullanabilmek için önce başarılı bir `Read` gereklidir.
