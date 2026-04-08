# Translate API Bağlam Kirliliği

## Arka Plan

CC-Viewer, Anthropic Messages API tarafından desteklenen yerleşik bir çeviri özelliği (`POST /api/translate`) içerir. Erken uygulamada, çeviri istekleri Claude Code oturumundan önbelleğe alınmış kimlik doğrulama bilgilerini yeniden kullanıyordu — hem `x-api-key` hem de `authorization` başlıkları dahil. Bu, ince ama ciddi bir soruna neden oldu: çeviri sonuçları sıklıkla alakasız içerik döndürüyordu.

## Temel Neden

### İki Kimlik Doğrulama Yöntemi Arasındaki Temel Fark

Anthropic API iki kimlik doğrulama yöntemini destekler:

| Yöntem | Başlık | Tipik Kaynak | Özellikler |
|--------|--------|--------------|------------|
| API Anahtarı | `x-api-key: sk-ant-...` | Ortam değişkeni / Console | Durumsuz, her istek bağımsızdır |
| OAuth Token | `authorization: Bearer sessionToken` | Claude Code abonelik girişi | Oturuma bağlı, sunucu bağlam ilişkilendirmesini sürdürür |

Temel fark: **API Anahtarları durumsuz (stateless)** — her istek tamamen bağımsızdır; oysa **OAuth oturum tokenları durumlu (stateful)** — Anthropic sunucusu aynı tokeni kullanan istekleri aynı oturum bağlamıyla ilişkilendirir.

### Kirlilik Zinciri

Claude Code abonelik OAuth girişi kullandığında, kimlik doğrulama akışı şöyle görünür:

```
Claude Code ana konuşma ──(authorization: Bearer sessionToken)──→ Anthropic API
                                                                      ↑
CC-Viewer çeviri isteği ──(authorization: Bearer sessionToken)──→ Anthropic API
```

Çeviri istekleri aynı oturum tokenını yeniden kullandığından, Anthropic sunucusu çeviri isteklerini Claude Code'un ana konuşma bağlamıyla ilişkilendirebilir. Bu durum şunlara yol açar:

1. **Çeviri sonuçları ana konuşma bağlamından etkilenir**: Çeviri isteğinin sistem promptu "sen bir çevirmensin" olmasına rağmen, sunucu bağlamı hâlâ Claude Code'un konuşma geçmişini içerir ve bu modeli potansiyel olarak etkileyebilir
2. **Ana konuşma çeviri istekleri tarafından bozulur**: Çeviri isteği içeriği (UI metin parçaları) ana konuşma bağlamına enjekte edilebilir ve Claude Code'un yanıtlarının sapmasına neden olabilir
3. **Öngörülemeyen davranış**: Bağlam kirliliği sunucu tarafı davranışı olduğundan, istemci bunu tespit edemez veya kontrol edemez

## Çıkarılan Dersler

- **OAuth oturum tokenları "sadece başka bir API Anahtarı" değildir** — sunucu tarafı durumu taşırlar, yeniden kullanmak bağlamı paylaşmak anlamına gelir
- **Dahili servis çağrıları, kullanıcı oturumlarıyla ilişkilendirmeden kaçınmak için bağımsız, durumsuz kimlik doğrulama kullanmalıdır**

## Referanslar

- [Anthropic API Authentication Docs](https://docs.anthropic.com/en/api/getting-started)
- [Claude Code Authentication](https://support.claude.com/en/articles/12304248-managing-api-key-environment-variables-in-claude-code)
- [Anthropic Bans Subscription OAuth in Third-Party Apps](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)
- [Claude Code Authentication: API Keys, Subscriptions, and SSO](https://developertoolkit.ai/en/claude-code/quick-start/authentication/)
