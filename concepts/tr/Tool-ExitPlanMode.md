# ExitPlanMode

## Tanım

Planlama modundan çıkar ve planı kullanıcı onayına sunar. Plan içeriği daha önce yazılmış plan dosyasından okunur.

## Parametreler

| Parametre | Tür | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `allowedPrompts` | array | Hayır | Uygulama planının gerektirdiği izin açıklamaları listesi |

`allowedPrompts` dizisindeki her öğe:

| Alan | Tür | Zorunlu | Açıklama |
|------|-----|---------|----------|
| `tool` | enum | Evet | Uygulanacak araç, şu anda yalnızca `Bash` desteklenir |
| `prompt` | string | Evet | İşlemin anlamsal açıklaması (örn. "run tests", "install dependencies") |

## Kullanım Senaryoları

**Kullanıma uygun:**
- Planlama modunda plan tamamlandı, kullanıcı onayına sunulmaya hazır
- Yalnızca kod yazılması gereken uygulama görevleri için

**Kullanıma uygun değil:**
- Salt araştırma/keşif görevi — planlama modundan çıkmaya gerek yok
- Kullanıcıya "Plan uygun mu?" diye sormak — bu tam olarak bu aracın işlevidir, AskUserQuestion kullanmayın

## Dikkat Edilecekler

- Bu araç plan içeriğini parametre olarak kabul etmez — daha önce yazılmış plan dosyasından okur
- Kullanıcı onay için plan dosyasının içeriğini görecektir
- Bu aracı çağırmadan önce AskUserQuestion ile "plan uygun mu?" diye sormayın, bu tekrardır
- Sorularda "plan"dan bahsetmeyin, çünkü kullanıcı ExitPlanMode'dan önce plan içeriğini göremez

## cc-viewer'da Önemi

ExitPlanMode çağrısı planlama aşamasının sonunu işaret eder. İstek günlüğünde bu çağrıdan sonraki istekler genellikle uygulama işlemlerine (Edit, Write, Bash vb.) dönüşür.

## Orijinal Metin

<textarea readonly>Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval.

## How This Tool Works
- You should have already written your plan to the plan file specified in the plan mode system message
- This tool does NOT take the plan content as a parameter - it will read the plan from the file you wrote
- This tool simply signals that you're done planning and ready for the user to review and approve
- The user will see the contents of your plan file when they review it

## When to Use This Tool
IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.

## Before Using This Tool
Ensure your plan is complete and unambiguous:
- If you have unresolved questions about requirements or approach, use AskUserQuestion first (in earlier phases)
- Once your plan is finalized, use THIS tool to request approval

**Important:** Do NOT use AskUserQuestion to ask "Is this plan okay?" or "Should I proceed?" - that's exactly what THIS tool does. ExitPlanMode inherently requests user approval of your plan.

## Examples

1. Initial task: "Search for and understand the implementation of vim mode in the codebase" - Do not use the exit plan mode tool because you are not planning the implementation steps of a task.
2. Initial task: "Help me implement yank mode for vim" - Use the exit plan mode tool after you have finished planning the implementation steps of the task.
3. Initial task: "Add a new feature to handle user authentication" - If unsure about auth method (OAuth, JWT, etc.), use AskUserQuestion first, then use exit plan mode tool after clarifying the approach.
</textarea>
