# Grep

ripgrep motorunu kullanarak dosya içeriklerini arar. Tam düzenli ifade desteği, dosya türü filtreleme ve kesinliği kompaktlık için takas edebileceğiniz üç çıktı modu sunar.

## Ne Zaman Kullanılır

- Bir fonksiyonun her çağrı yerini veya bir tanımlayıcının her referansını bulmak
- Bir string veya hata mesajının kod tabanında herhangi bir yerde görünüp görünmediğini kontrol etmek
- Refactoring'den önce etkiyi ölçmek için bir desenin geçişlerini saymak
- Bir aramayı bir dosya türüne (`type: "ts"`) veya glob'a (`glob: "**/*.tsx"`) daraltmak
- `multiline: true` ile çok satırlı struct tanımları veya JSX blokları gibi çapraz-satır eşleşmelerini çekmek

## Parametreler

- `pattern` (string, zorunlu): Aranacak düzenli ifade. ripgrep sözdizimi kullanır, bu yüzden literal süslü parantezlerin kaçış karakteri gerektirir (örneğin `interface{}` bulmak için `interface\{\}`).
- `path` (string, opsiyonel): Aranacak dosya veya dizin. Varsayılan olarak mevcut çalışma dizini.
- `glob` (string, opsiyonel): `*.js` veya `*.{ts,tsx}` gibi dosya adı filtresi.
- `type` (string, opsiyonel): `js`, `py`, `rust`, `go` gibi dosya türü kısayolu. Standart diller için `glob`'dan daha verimli.
- `output_mode` (enum, opsiyonel): `files_with_matches` (varsayılan, yalnızca yolları döndürür), `content` (eşleşen satırları döndürür) veya `count` (eşleşme sayılarını döndürür).
- `-i` (boolean, opsiyonel): Büyük/küçük harf duyarsız eşleştirme.
- `-n` (boolean, opsiyonel): `content` modunda satır numaralarını dahil et. Varsayılan `true`.
- `-A` (number, opsiyonel): Her eşleşmeden sonra gösterilecek bağlam satırı sayısı (`content` modu gerektirir).
- `-B` (number, opsiyonel): Her eşleşmeden önceki bağlam satırları (`content` modu gerektirir).
- `-C` / `context` (number, opsiyonel): Her eşleşmenin iki tarafındaki bağlam satırları.
- `multiline` (boolean, opsiyonel): Desenlerin yeni satırları kapsamasına izin ver (`.` `\n` ile eşleşir). Varsayılan `false`.
- `head_limit` (number, opsiyonel): Döndürülen satırları, dosya yollarını veya sayım girişlerini sınırlar. Varsayılan 250; sınırsız için `0` geçirin (cimri kullanın).
- `offset` (number, opsiyonel): `head_limit` uygulamadan önce ilk N sonucu atla. Varsayılan `0`.

## Örnekler

### Örnek 1: Bir fonksiyonun tüm çağrı yerlerini bulmak
Her çağrının çevreleyen satırlarını görmek için `pattern: "registerHandler\\("`, `output_mode: "content"` ve `-C: 2` olarak ayarlayın.

### Örnek 2: Bir tür genelinde eşleşme saymak
Python kaynakları arasında dosya başına TODO toplamlarını görmek için `pattern: "TODO"`, `type: "py"` ve `output_mode: "count"` olarak ayarlayın.

### Örnek 3: Çok satırlı struct eşleşmesi
Bir Go struct'ı içinde birkaç satır derinlikte bildirilmiş bir alanı yakalamak için `multiline: true` ile `pattern: "struct Config \\{[\\s\\S]*?version"` kullanın.

## Notlar

- Her zaman `Bash` aracılığıyla `grep` veya `rg` çalıştırmak yerine `Grep`'i tercih edin; araç doğru izinler ve yapılandırılmış çıktı için optimize edilmiştir.
- Varsayılan çıktı modu en ucuz olan `files_with_matches`'tır. Yalnızca satırların kendisini görmeniz gerektiğinde `content`'e geçin.
- Bağlam bayrakları (`-A`, `-B`, `-C`) `output_mode` `content` olmadıkça yok sayılır.
- Büyük sonuç kümeleri bağlam tokenlarını yakar. Odaklı kalmak için `head_limit`, `offset` veya daha sıkı `glob`/`type` filtreleri kullanın.
- Dosya adı keşfi için `Glob` kullanın; birçok turda açık uçlu araştırmalar için Explore ajanıyla bir `Agent` gönderin.
