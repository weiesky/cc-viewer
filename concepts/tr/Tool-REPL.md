# REPL

Oturum içinde kalıcı bir Node.js vm bağlamında JavaScript çalıştırır. Üst düzey `await` desteklenir ve bir çağrıda tanımlanan değişkenler/fonksiyonlar sonraki çağrılarda kullanılabilir kalır.

## Ne Zaman Kullanılır

- Kabuk tek satırlıklarından ziyade kod içinde daha kolay olan hızlı hesaplama, veri dönüştürme veya JSON düzenleme.
- Ara durumun çağrılar arasında kalması gereken çok adımlı betik yazma (sayaçlar, birikmiş sonuçlar).
- Bir dosyaya yazmadan önce bir API'nin veya kitaplığın davranışını etkileşimli olarak araştırma.

## Etkinleştirme

- Varsayılan olarak kapalıdır — etkinleştirmek için `CLAUDE_CODE_REPL=true` ayarlayın.
- Terminal (`cli`) ve claude.ai (`remote`) oturumlarında sunucu tarafı bir özellik bayrağı da bunu etkinleştirebilir.
- Kapalıyken REPL modelin araç listesinden gizlenir. Açıkken `Read`, `Glob`, `Grep`, `Bash`, `PowerShell` ve `NotebookEdit` REPL kısayollarıyla değiştirilir.

## Parametreler

- `code` (string, zorunlu): Çalıştırılacak JavaScript kodu. Üst düzey await'i destekler. Durum çağrılar arasında korunur.
- `description` (string, opsiyonel): Bu betiğin ne yaptığının etken çatıda açık, öz bir açıklaması (5–10 kelime), ör. "Trace upgrade message to its GrowthBook flag".
- `timeout` (number, opsiyonel): Milisaniye cinsinden zaman aşımı. Varsayılan 30000; maksimum 600000.

## Örnekler

### Örnek 1: Durum hesaplamak ve yeniden kullanmak

```
REPL(code="const counts = new Map(); ['a','b','a'].forEach(k => counts.set(k, (counts.get(k)||0)+1)); counts.get('a')")
```

`2` döndürür; `counts` aynı oturumdaki sonraki REPL çağrıları için tanımlı kalır.

### Örnek 2: Daha uzun zaman aşımıyla üst düzey await

```
REPL(
  code="const res = await fetch('https://example.com/api'); await res.json()",
  description="Fetch example API and parse JSON",
  timeout=60000
)
```

## Notlar

- Durum oturum başınadır: oturumu yeniden başlatmak tüm tanımları temizler.
- Bu bir JavaScript (Node) ortamıdır — kabuk komutları, dosya sistemi ağırlıklı işler veya JS dışı çalışma zamanları için Bash kullanın.
- Uzun süre çalışan kod açık bir `timeout` ayarlamalıdır; varsayılan 30 saniye daha yavaş olan her şeyi sonlandırır.
