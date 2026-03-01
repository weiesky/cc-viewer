# WebSearch

## Tanım

Arama motoru sorgusu çalıştırır ve güncel bilgi almak için arama sonuçlarını döndürür.

## Parametreler

| Parametre | Tür | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `query` | string | Evet | Arama sorgusu (en az 2 karakter) |
| `allowed_domains` | string[] | Hayır | Yalnızca bu alan adlarından sonuçları dahil et |
| `blocked_domains` | string[] | Hayır | Bu alan adlarından sonuçları hariç tut |

## Kullanım Senaryoları

**Kullanıma uygun:**
- Modelin bilgi kesme tarihini aşan güncel bilgileri alma
- Güncel olayları ve en son verileri bulma
- En güncel teknik belgeleri arama

## Dikkat Edilecekler

- Arama sonuçları markdown köprü formatında döndürülür
- Kullanımdan sonra yanıtın sonuna "Sources:" bölümü eklenmeli ve ilgili URL'ler listelenmelidir
- Alan adı filtrelemeyi destekler (dahil etme/hariç tutma)
- Arama sorgusunda güncel yıl kullanılmalıdır
- Yalnızca ABD'de kullanılabilir

## cc-viewer'da Önemi

WebSearch çağrıları istek günlüğünde `tool_use` / `tool_result` content block çifti olarak görünür. `tool_result` arama sonuçları listesini içerir.

## Orijinal Metin

<textarea readonly>
- Allows Claude to search the web and use the results to inform responses
- Provides up-to-date information for current events and recent data
- Returns search result information formatted as search result blocks, including links as markdown hyperlinks
- Use this tool for accessing information beyond Claude's knowledge cutoff
- Searches are performed automatically within a single API call

CRITICAL REQUIREMENT - You MUST follow this:
  - After answering the user's question, you MUST include a "Sources:" section at the end of your response
  - In the Sources section, list all relevant URLs from the search results as markdown hyperlinks: [Title](URL)
  - This is MANDATORY - never skip including sources in your response
  - Example format:

    [Your answer here]

    Sources:
    - [Source Title 1](https://example.com/1)
    - [Source Title 2](https://example.com/2)

Usage notes:
  - Domain filtering is supported to include or block specific websites
  - Web search is only available in the US

IMPORTANT - Use the correct year in search queries:
  - The current month is March 2026. You MUST use this year when searching for recent information, documentation, or current events.
  - Example: If the user asks for "latest React docs", search for "React documentation" with the current year, NOT last year
</textarea>
