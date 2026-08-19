# SearchMcpRegistry

Görevi tamamlamaya yardımcı olabilecek connector'ları keşfetmek için MCP connector kayıt defterini anahtar kelimeyle arar.

## Ne Zaman Kullanılır

- Görev bir dış hizmetten (bir veritabanı, bir sorun izleyici, bir SaaS API'si) faydalanacak ve bunun için bir MCP connector'ının var olup olmadığını kontrol etmek istiyorsunuz.
- Kullanıcı bir ürünü adlandırır ve onu bağlamayı ister — kayıt defterinde eşleşen bir connector arayın.

## Etkinleştirme

- Yalnızca birinci taraf API üzerindeki uzak (claude.ai) oturumlarda mevcuttur.

## Parametreler

- `keywords` (string dizisi, zorunlu): Kullanıcının niyetini veya adlandırılmış bir ürünü tanımlayan anahtar kelime ifadeleri. 1–8 öğe, her biri 1–64 karakter.

## Örnekler

### Örnek 1: Adlandırılmış bir ürün için connector bulmak

```
SearchMcpRegistry(keywords=["linear", "issue tracker"])
```

Connector'ları anahtar kelimelerle eşleşen kayıt defteri girdilerini döndürür. Tam connector ayrıntılarını `SuggestConnectors` ile çözün.

## Notlar

- Salt okunur ve eşzamanlılık açısından güvenli; sonuçların boyutu sınırlandırılmıştır.
- Arama hiçbir şey yüklemez — tamamen keşif amaçlıdır.
