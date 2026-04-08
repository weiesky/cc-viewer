# MainAgent

## Tanım

MainAgent, Claude Code'un agent team durumunda olmadığı zamanlardaki ana istek zinciridir. Kullanıcının Claude Code ile her etkileşimi bir dizi API isteği üretir ve bunlar arasında MainAgent istekleri çekirdek konuşma zincirini oluşturur — tam system prompt, araç tanımları ve mesaj geçmişi taşırlar.

## Tanımlama Yöntemi

cc-viewer'da MainAgent, `req.mainAgent === true` ile tanımlanır ve `interceptor.js` tarafından istek yakalama sırasında otomatik olarak işaretlenir.

Belirleme koşulları (tümü karşılanmalı):
- İstek gövdesi `system` alanı içerir (system prompt)
- İstek gövdesi `tools` dizisi içerir (araç tanımları)
- system prompt "Claude Code" karakteristik metni içerir

## SubAgent ile Farkları

| Özellik | MainAgent | SubAgent |
|---------|-----------|----------|
| system prompt | Tam Claude Code ana prompt'u | Göreve özel kısaltılmış prompt |
| tools dizisi | Tüm kullanılabilir araçları içerir | Genellikle yalnızca görev için gereken az sayıda araç |
| Mesaj geçmişi | Tam konuşma bağlamını biriktirir | Yalnızca alt görevle ilgili mesajlar |
| Önbellek davranışı | Prompt caching var (5 dakika TTL) | Genellikle önbellek yok veya küçük önbellek |
