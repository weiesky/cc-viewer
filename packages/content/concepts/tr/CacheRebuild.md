# Cache Rebuild (Önbellek Yeniden Oluşturma)

## Arka Plan

Anthropic'in prompt caching mekanizması, istekteki system → tools → messages (cache breakpoint'e kadar) sırasıyla birleştirerek önbellek anahtarı oluşturur. Önbellek anahtarı bir önceki istekle tamamen aynı olduğunda, API `cache_read_input_tokens` döndürür (önbellek isabet); önbellek anahtarı değiştiğinde, API önbelleği yeniden oluşturur ve büyük miktarda `cache_creation_input_tokens` döndürür, yani önbellek yeniden oluşturma gerçekleşir.

Önbellek yeniden oluşturma ek token ücreti anlamına gelir (cache creation fiyatı cache read'den yüksektir), bu nedenle yeniden oluşturma nedenini belirlemek maliyet optimizasyonu için doğrudan değer taşır.

## Önbellek Yeniden Oluşturma Neden Sınıflandırması

cc-viewer, ardışık iki MainAgent isteğinin gövdesini karşılaştırarak önbellek yeniden oluşturma nedenini kesin olarak belirler:

| reason | Anlamı | Belirleme Yöntemi |
|--------|--------|-------------------|
| `ttl` | Önbellek süresi doldu | Önceki MainAgent isteğinden bu yana 5 dakikadan fazla geçmiş |
| `system_change` | system prompt değişikliği | `JSON.stringify(prev.system) !== JSON.stringify(curr.system)` |
| `tools_change` | Araç tanımı değişikliği | `JSON.stringify(prev.tools) !== JSON.stringify(curr.tools)` |
| `model_change` | Model değişikliği | `prev.model !== curr.model` |
| `msg_truncated` | Mesaj yığını kesildi | Mevcut isteğin messages sayısı öncekinden az, genellikle bağlam penceresi taşması nedeniyle kesme tetiklenir |
| `msg_modified` | Geçmiş mesajlar değiştirildi | Önek mesaj içerikleri tutarsız (normal ekleme modunda önek tamamen aynı olmalıdır) |
| `key_change` | Bilinmeyen anahtar değişikliği | Yukarıdaki koşulların hiçbiri eşleşmediğinde fallback |

## Belirleme Önceliği

1. Önce zaman aralığı kontrol edilir — 5 dakikayı aşarsa doğrudan `ttl` olarak belirlenir, body karşılaştırması yapılmaz
2. Ardından sırasıyla model, system, tools, messages kontrol edilir
3. Bir istek aynı anda birden fazla nedene sahip olabilir (örn. model değişikliği + system prompt değişikliği), bu durumda `reasons` dizisi tüm eşleşmeleri içerir, tooltip satır satır gösterir

## Yaygın Senaryolar

- **`ttl`**: Kullanıcı 5 dakikadan fazla ara verdikten sonra devam eder, önbellek doğal olarak sona erer
- **`system_change`**: Claude Code system prompt'u güncelledi (örn. yeni CLAUDE.md yüklendi, project instructions değişti)
- **`tools_change`**: MCP server bağlantı/kopma nedeniyle kullanılabilir araç listesi değişti
- **`model_change`**: Kullanıcı `/model` komutuyla model değiştirdi
- **`msg_truncated`**: Konuşma çok uzadığında bağlam penceresi yönetimi tetiklenir, Claude Code erken mesajları keser
- **`msg_modified`**: Claude Code geçmiş mesajları düzenledi (örn. `/compact` sıkıştırma özeti orijinal mesajların yerini aldı)
