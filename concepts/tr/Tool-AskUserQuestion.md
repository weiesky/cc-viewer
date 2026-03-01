# AskUserQuestion

## Tanım

Yürütme sırasında kullanıcıya soru sorarak açıklama alma, varsayımları doğrulama veya karar isteme amacıyla kullanılır.

## Parametreler

| Parametre | Tür | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `questions` | array | Evet | Soru listesi (1-4 soru) |
| `answers` | object | Hayır | Kullanıcıdan toplanan yanıtlar |
| `annotations` | object | Hayır | Her soru için notlar (örn. önizleme seçimi açıklamaları) |
| `metadata` | object | Hayır | İzleme ve analiz için meta veriler |

Her `question` nesnesi:

| Alan | Tür | Zorunlu | Açıklama |
|------|-----|---------|----------|
| `question` | string | Evet | Tam soru metni, soru işaretiyle bitmelidir |
| `header` | string | Evet | Kısa etiket (en fazla 12 karakter), etiket çipi olarak gösterilir |
| `options` | array | Evet | 2-4 seçenek |
| `multiSelect` | boolean | Evet | Çoklu seçime izin verilip verilmediği |

Her `option` nesnesi:

| Alan | Tür | Zorunlu | Açıklama |
|------|-----|---------|----------|
| `label` | string | Evet | Seçenek görüntüleme metni (1-5 kelime) |
| `description` | string | Evet | Seçenek açıklaması |
| `markdown` | string | Hayır | Önizleme içeriği (ASCII düzeni, kod parçacıkları vb. için görsel karşılaştırma) |

## Kullanım Senaryoları

**Kullanıma uygun:**
- Kullanıcı tercihlerini veya gereksinimlerini toplama
- Belirsiz talimatları netleştirme
- Uygulama sürecinde karar alma
- Kullanıcıya yön seçenekleri sunma

**Kullanıma uygun değil:**
- "Plan uygun mu?" diye sormak — ExitPlanMode kullanılmalıdır

## Dikkat Edilecekler

- Kullanıcı her zaman "Other" seçerek özel girdi sağlayabilir
- Önerilen seçenek ilk sıraya konulmalı ve label sonuna "(Recommended)" eklenmelidir
- `markdown` önizlemesi yalnızca tek seçimli sorularda desteklenir
- `markdown` içeren seçenekler yan yana düzene geçer
- Planlama modunda, planı kesinleştirmeden önce gereksinimleri netleştirmek için kullanılır

## cc-viewer'da Önemi

AskUserQuestion çağrısı istek günlüğünde `tool_use` content block olarak görünür ve soru ile seçenek tanımlarını içerir. Kullanıcının yanıtı sonraki isteklerin mesaj geçmişinde yer alır.

## Orijinal Metin

<textarea readonly>Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

Plan mode note: In plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?" or "Should I proceed?" - use ExitPlanMode for plan approval. IMPORTANT: Do not reference "the plan" in your questions (e.g., "Do you have feedback about the plan?", "Does the plan look good?") because the user cannot see the plan in the UI until you call ExitPlanMode. If you need plan approval, use ExitPlanMode instead.

Preview feature:
Use the optional `markdown` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

When any option has a markdown, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).
</textarea>
