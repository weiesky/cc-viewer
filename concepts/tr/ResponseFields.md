# Response Body Alan Açiklamasi

Claude API `/v1/messages` yanit gövdesinin alan açiklamasi.

## Üst Düzey Alanlar

| Alan | Tür | Açiklama |
|------|------|------|
| **model** | string | Gerçekte kullanilan model adi, örnegin `claude-opus-4-6` |
| **id** | string | Bu yanitin benzersiz tanimlayicisi, örnegin `msg_01Tgsr2QeH8AVXGoP2wAXRvU` |
| **type** | string | Sabit deger `"message"` |
| **role** | string | Sabit deger `"assistant"` |
| **content** | array | Modelin ürettigi içerik bloklari dizisi; metin, araç çagrilari, düsünme süreci vb. içerir |
| **stop_reason** | string | Durma nedeni: `"end_turn"` (normal bitis), `"tool_use"` (araç çalistirmak gerekiyor), `"max_tokens"` (token sinirana ulasildi) |
| **stop_sequence** | string/null | Durmayi tetikleyen dizi, genellikle `null` |
| **usage** | object | Token kullanim istatistikleri (ayrintilari asagida) |

## content Blok Türleri

| Tür | Açiklama |
|------|------|
| **text** | Modelin metin yaniti, `text` alani içerir |
| **tool_use** | Araç çagri istegi; `name` (araç adi), `input` (parametreler), `id` (çagri ID'si, tool_result ile eslestirilir) içerir |
| **thinking** | Genisletilmis düsünme içerigi (yalnizca thinking modu açikken görünür), `thinking` alani içerir |

## usage Alani Ayrintilari

| Alan | Açiklama |
|------|------|
| **input_tokens** | Önbellege isabet etmeyen giris token sayisi (tam fiyatla ücretlendirilir) |
| **cache_creation_input_tokens** | Bu istekte yeni olusturulan önbellek token sayisi (önbellek yazma, normal giristen daha yüksek ücretlendirilir) |
| **cache_read_input_tokens** | Önbellege isabet eden token sayisi (önbellek okuma, normal giristen çok daha düsük ücretlendirilir) |
| **output_tokens** | Modelin çikis token sayisi |
| **service_tier** | Hizmet seviyesi, örnegin `"standard"` |
| **inference_geo** | Çikarim bölgesi, örnegin `"not_available"` bölge bilgisinin mevcut olmadigini belirtir |

## cache_creation Alt Alanlari

| Alan | Açiklama |
|------|------|
| **ephemeral_5m_input_tokens** | 5 dakika TTL'li kisa süreli önbellek olusturma token sayisi |
| **ephemeral_1h_input_tokens** | 1 saat TTL'li uzun süreli önbellek olusturma token sayisi |

> **Önbellek ücretlendirmesi hakkinda**: `cache_read_input_tokens` birim fiyati `input_tokens`'dan çok daha düsüktür; `cache_creation_input_tokens` birim fiyati ise normal giristen biraz daha yüksektir. Bu nedenle, sürekli konusmalarda yüksek önbellek isabet oranini korumak maliyetleri önemli ölçüde azaltabilir. Bu orani cc-viewer'daki "isabet orani" göstergesiyle görsel olarak izleyebilirsiniz.

## stop_reason Anlamlari

- **end_turn**: Model yaniti normal sekilde tamamladi
- **tool_use**: Modelin araç çagirmasi gerekiyor, content içinde `tool_use` blogu bulunacaktir. Konusmaya devam etmek için sonraki istekte messages'a `tool_result` eklenmesi gerekir
- **max_tokens**: `max_tokens` sinirana ulasilarak kesildi, yanit eksik olabilir
