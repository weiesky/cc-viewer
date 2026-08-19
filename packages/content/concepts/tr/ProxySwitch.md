# Anlık Geçiş Proxy'si

## Genel Bakış

Anlık Geçiş Proxy'si, Claude Code'u yeniden başlatmadan API isteklerini dinamik olarak farklı bir uç noktaya yönlendirmenizi sağlar. Üçüncü taraf API proxy hizmetleri kullanırken faydalıdır.

> ⚠️ Claude Max aboneliğiniz varsa bu özelliği kullanmayın.

## Alanlar

| Alan | Zorunlu | Açıklama |
|------|---------|----------|
| **Name** | ✅ | Bu proxy'yi tanımlamak için kullanılan görünen ad |
| **Base URL** | ✅ | API hizmetinin temel URL'si (ör. `https://api.example.com`). Orijinal istek kaynağı bununla değiştirilir |
| **API Key** | ✅ | Proxy hizmetinin API anahtarı, orijinal kimlik doğrulamanın yerini alır |
| **ANTHROPIC_MODEL** | ❌ | Birincil model. Modeli `fable` / `mythos` ailesine ait olan istekler buna yeniden yazılır |
| **ANTHROPIC_DEFAULT_OPUS_MODEL** | ❌ | Genişletilmiş: modeli `opus` içeren istekler buna yeniden yazılır |
| **ANTHROPIC_DEFAULT_SONNET_MODEL** | ❌ | Genişletilmiş: modeli `sonnet` içeren istekler buna yeniden yazılır |
| **ANTHROPIC_DEFAULT_HAIKU_MODEL** | ❌ | Genişletilmiş: modeli `haiku` içeren istekler buna yeniden yazılır |
| **Effort Level** | ❌ | İstek gövdesine `output_config.effort` (`low`/`medium`/`high`/`xhigh`/`max`) ekler. Atlamak için "Default" olarak bırakın |

Model eşleştirme, isteğin `model` alanı üzerinde büyük/küçük harfe duyarsız bir alt dize testidir; böylece herhangi bir sürüm (ör. `claude-opus-4-8`, gelecekteki bir `claude-opus-5`) yeniden yapılandırma gerektirmeden aynı aileye eşlenir. Boş bir aile alanı, o ailenin değiştirilmeden bırakıldığı anlamına gelir; tanınmayan bir aile olduğu gibi geçirilir.

## Nasıl Çalışır

Bir proxy etkin olduğunda, `server/interceptor.js` her API isteğinden önce şunları yapar:

1. **URL Rewrite** — İstek kaynağını proxy'nin Base URL'si ile değiştirir
2. **Auth Replace** — `x-api-key` veya `Authorization` başlığını proxy'nin API Anahtarı ile değiştirir
3. **Model Replace** — İstek gövdesindeki `model` alanını aileye göre yeniden yazar (opus/sonnet/haiku → eşleşen alan; fable/mythos → `ANTHROPIC_MODEL`)
4. **Effort Inject** — Bir effort seviyesi ayarlanmışsa `output_config.effort` ekler (`count_tokens` / heartbeat istekleri için atlanır)

## Yapılandırma Dosyası

Yapılandırma `~/.claude/cc-viewer/profile.json` konumunda saklanır. Dizini açmak için başlıktaki klasör simgesine tıklayın:

```json
{
  "active": "my-proxy",
  "profiles": [
    { "id": "max", "name": "Max" },
    {
      "id": "my-proxy",
      "name": "My Proxy",
      "baseURL": "https://api.example.com",
      "apiKey": "sk-xxx",
      "ANTHROPIC_MODEL": "model-primary",
      "ANTHROPIC_DEFAULT_OPUS_MODEL": "model-opus",
      "ANTHROPIC_DEFAULT_SONNET_MODEL": "model-sonnet",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL": "model-haiku",
      "effort": "max"
    }
  ]
}
```

- `active` — Mevcut profilin ID'si. Doğrudan bağlantı (proxy yok) için `"max"` olarak ayarlayın
- `profiles` — Profil listesi. `id: "max"` yerleşiktir ve silinemez
- `models` / `activeModel` kullanan eski profiller, yüklenirken otomatik olarak `ANTHROPIC_MODEL`'e taşınır
- Değişiklikler ~1,5 saniye içinde etkili olur (`fs.watchFile` ile izlenir), yeniden başlatma gerekmez
