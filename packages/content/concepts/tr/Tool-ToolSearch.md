# ToolSearch

"Ertelenmiş araçların" tam schema tanımlarını talep üzerine getirir, böylece çağrılabilir hâle gelirler. Çok sayıda araç mevcut olduğunda, bazıları önceden yüklenmez — yalnızca `<system-reminder>` mesajları içinde adlarıyla görünürler. Schema'sı getirilene kadar yalnızca adı bilinir ve parametre tanımı yoktur, dolayısıyla araç çağrılamaz. `ToolSearch` bir sorgu alır, bunu ertelenmiş araç listesiyle eşleştirir ve eşleşen araçların tam JSONSchema tanımlarını bir `<functions>` bloğu içinde döndürür. Bir aracın schema'sı sonuçta göründüğü anda, prompt'un en üstünde tanımlı herhangi bir araç gibi çağrılabilir.

## Ne Zaman Kullanılır

- Ertelenmiş bir araca ihtiyacınız var — adı bir `<system-reminder>` içinde görünüyor, ancak üst düzey araç listesinde onun için bir parametre tanımı yok.
- Talep üzerine yüklenen bir MCP sunucusunun araçlarını (örneğin Slack, Gmail, computer-use) kullanmak istiyorsunuz.
- Bir yetenek için aracın tam adından emin değilsiniz ve adayları tek seferde anahtar kelimeyle yüzeye çıkarmak istiyorsunuz.

Bir aracın schema'sı zaten bağlamdaysa, tekrar arama yapmayın — yalnızca onu çağırın.

## Etkinleştirme

- Varsayılan olarak açıktır.
- `ANTHROPIC_BASE_URL` Anthropic dışı bir uç noktayı gösterdiğinde (`ENABLE_TOOL_SEARCH` ayarlanmadıkça), `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` ayarlandığında, model araç referansı desteğinden yoksun olduğunda (Claude 4.5 öncesi Vertex AI modelleri) veya `"deny": ["ToolSearch"]` ile reddedildiğinde kapalıdır.

## Parametreler

- `query` (string, zorunlu): Ertelenmiş araçları bulmak için kullanılan sorgu. Üç biçim desteklenir:
  - `select:Read,Edit,Grep` — bu tam araçları adıyla getirir.
  - `notebook jupyter` — anahtar kelime araması; en iyi `max_results` eşleşmeye kadar döndürür.
  - `+slack send` — araç adında `slack` geçmesini zorunlu kılar, ardından kalan terimlere göre sıralar.
- `max_results` (number, opsiyonel): Döndürülecek azami sonuç sayısı. Varsayılan olarak 5.

## Örnekler

### Örnek 1: Tam adla getirme

```
ToolSearch(query="select:WebFetch,WebSearch", max_results=5)
```

### Örnek 2: Anahtar kelime araması

```
ToolSearch(query="notebook jupyter", max_results=5)
```

### Örnek 3: Bütün bir MCP araç setini tek seferde yükleme

Bir MCP sunucusunun tüm araçlarını toplu yüklerken (örneğin computer-use), her birini tek tek seçmek yerine tek bir anahtar kelime araması kullanın — alt dize olarak sunucu adı, o sunucu altındaki her araçla eşleşir:

```
ToolSearch(query="computer-use", max_results=30)
```

## Notlar

- Ertelenmiş bir aracı çağırmadan önce, schema'sını ilkin `ToolSearch` ile getirmelisiniz — doğrudan çağırmak, parametre tanımı eksik olduğu için başarısız olur.
- Bütün bir araç setini toplu yüklerken (örneğin bir MCP sunucusunun tüm araçları), gidiş gelişleri azaltmak için çok sayıda `select:` çağrısı yerine tek bir anahtar kelime aramasını tercih edin.
- Bir schema getirildiğinde araç tam olarak herhangi bir normal araç gibi davranır; aynı aracı tekrar aramayın.
- Sonuçlar bir `<functions>` bloğu olarak döner; her araç tek bir `<function>{...}</function>` satırıdır — üst düzey araç listesiyle aynı kodlama.
