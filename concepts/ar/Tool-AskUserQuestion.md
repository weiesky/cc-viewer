# AskUserQuestion

## التعريف

طرح أسئلة على المستخدم أثناء التنفيذ، للحصول على توضيحات أو التحقق من الافتراضات أو طلب اتخاذ قرارات.

## المعاملات

| المعامل | النوع | مطلوب | الوصف |
|---------|-------|-------|-------|
| `questions` | array | نعم | قائمة الأسئلة (1-4 أسئلة) |
| `answers` | object | لا | الإجابات التي جمعها المستخدم |
| `annotations` | object | لا | ملاحظات لكل سؤال (مثل ملاحظات معاينة الاختيارات) |
| `metadata` | object | لا | بيانات وصفية للتتبع والتحليل |

كل كائن `question`:

| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `question` | string | نعم | نص السؤال الكامل، يجب أن ينتهي بعلامة استفهام |
| `header` | string | نعم | تسمية قصيرة (12 حرفاً كحد أقصى)، تُعرض كشريحة تسمية |
| `options` | array | نعم | 2-4 خيارات |
| `multiSelect` | boolean | نعم | هل يُسمح بالاختيار المتعدد |

كل كائن `option`:

| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `label` | string | نعم | نص عرض الخيار (1-5 كلمات) |
| `description` | string | نعم | وصف الخيار |
| `markdown` | string | لا | محتوى المعاينة (للمقارنة المرئية لتخطيطات ASCII ومقتطفات الكود وغيرها) |

## سيناريوهات الاستخدام

**مناسب للاستخدام:**
- جمع تفضيلات أو متطلبات المستخدم
- توضيح التعليمات الغامضة
- الحصول على قرارات أثناء التنفيذ
- تقديم خيارات اتجاهية للمستخدم

**غير مناسب للاستخدام:**
- السؤال "هل الخطة مقبولة؟" — يجب استخدام ExitPlanMode

## ملاحظات

- يمكن للمستخدم دائماً اختيار "Other" لتقديم إدخال مخصص
- يُوضع الخيار الموصى به في المقام الأول مع إضافة "(Recommended)" في نهاية label
- معاينة `markdown` تدعم فقط أسئلة الاختيار الفردي
- الخيارات التي تحتوي على `markdown` تتحول إلى تخطيط جنباً إلى جنب
- في وضع التخطيط، تُستخدم لتوضيح المتطلبات قبل تحديد الخطة

## الأهمية في cc-viewer

يظهر استدعاء AskUserQuestion في سجل الطلبات ككتلة محتوى `tool_use`، تحتوي على تعريفات الأسئلة والخيارات. تظهر إجابات المستخدم في سجل الرسائل للطلبات اللاحقة.

## النص الأصلي

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
