# Glob

Dosya adlarını bir glob desenine karşı eşleştirir ve yolları önce en son değiştirilme zamanına göre sıralanmış olarak döndürür. `find`'e kabuk çağrısı yapmadan herhangi bir boyuttaki kod tabanlarında dosyaları hızlıca bulmak için optimize edilmiştir.

## Ne Zaman Kullanılır

- Belirli bir uzantının her dosyasını numaralandırmak (örneğin `src` altındaki tüm `*.ts` dosyaları)
- Adlandırma kuralına göre yapılandırma veya fikstür dosyalarını keşfetmek (`**/jest.config.*`, `**/*.test.tsx`)
- Hedefli bir `Grep` çalıştırmadan önce arama yüzeyini daraltmak
- `Write` çağırmadan önce bilinen bir desende bir dosyanın zaten var olup olmadığını kontrol etmek
- Değiştirme-zamanı sıralamasına dayanarak yakın zamanda dokunulan dosyaları bulmak

## Parametreler

- `pattern` (string, zorunlu): Eşleşecek glob ifadesi. Tek-segmentli joker karakterler için `*`, özyinelemeli eşleşmeler için `**` ve alternatifler için `{a,b}` destekler, örneğin `src/**/*.{ts,tsx}`.
- `path` (string, opsiyonel): Aramanın çalıştırılacağı dizin. Sağlandığında geçerli bir dizin yolu olmalıdır. Mevcut çalışma dizinini aramak için alanı tamamen atlayın. `"undefined"` veya `"null"` stringlerini geçirmeyin.

## Örnekler

### Örnek 1: Her TypeScript kaynak dosyası
`pattern: "src/**/*.ts"` ile `Glob` çağırın. Sonuç mtime-sıralı bir listedir, bu nedenle en son düzenlenen dosyalar önce görünür, bu da sıcak noktalara odaklanmak için kullanışlıdır.

### Örnek 2: Sınıf tanımı adayı bulmak
Bir sınıfın, adını bilmediğiniz bir dosyada yaşadığından şüpheleniyorsanız, adayları daraltmak için `pattern: "**/*UserService*"` ile arayın, sonra `Read` veya `Grep` ile takip edin.

### Örnek 3: Büyük bir görevden önce paralel keşif
Tek bir mesajda, birden fazla `Glob` çağrısı (örneğin biri `**/*.test.ts` için ve biri `**/fixtures/**` için) yayınlayın; böylece her ikisi paralel çalışır ve sonuçları ilişkilendirilebilir.

## Notlar

- Sonuçlar alfabetik olarak değil, dosya değiştirilme zamanına göre (en yeni önce) sıralanır. Kararlı sıralamaya ihtiyacınız varsa aşağı yönde sıralayın.
- Desenler kabuk tarafından değil, araç tarafından değerlendirilir; komut satırında olduğu gibi tırnak içine almanıza veya kaçış karakteri eklemenize gerek yoktur.
- Birçok arama ve akıl yürütme turu gerektiren açık uçlu keşifler için, birçok `Glob` çağrısını zincirlemek yerine Explore ajan türüyle bir `Agent`'a devredin.
- Dosya adı keşfi için `find` veya `ls`'nin `Bash` çağrılarına göre `Glob`'u tercih edin; izinleri tutarlı şekilde yönetir ve yapılandırılmış çıktı döndürür.
- Dosya adları yerine dosyaların içindeki içeriği arıyorsanız, bunun yerine `Grep` kullanın.
