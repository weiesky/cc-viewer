# SendFeedback

يرسل ملاحظات منظمة حول Claude Code إلى Anthropic — تقارير أخطاء أو أفكار ميزات أو قدرات ناقصة — دون مغادرة الجلسة.

## متى يُستخدم

- يطلب المستخدم الإبلاغ عن خطأ أو إرسال ملاحظات حول Claude Code نفسه.
- تصادف عيب منتج واضحاً (أمر معطل أو سلوك خاطئ أو انهيار) يستحق الإبلاغ.
- يصف المستخدم ميزة يتمنى وجودها (فكرة أو قدرة ناقصة).

## المعاملات

- `type` (سلسلة، مطلوب): واحدة من `bug` أو `idea` أو `missing_capability`.
- `title` (سلسلة، مطلوب): ملخص قصير ومحدد من سطر واحد للمشكلة.
- `details` (سلسلة، مطلوب): نقاط موسومة، بالترتيب: **ما حدث:** (الملاحَظ مقابل المتوقع، نص الخطأ الحرفي إن كان قصيراً)؛ **ما قاله المستخدم:** (منقولاً حرفياً، أو "User didn't comment; observed by the model.")؛ **إعادة الإنتاج:** (خطوات دنيا)؛ **الأدلة:** (معرفات طلب، طابع زمني، مسارات، إصدارات — احذفها إن لم توجد)؛ واختيارياً **السبب:** في النهاية فقط إذا تحقق منه داخل الجلسة. سطر إلى ثلاثة أسطر لكل نقطة؛ لا فقرات سردية ولا تخمين ولا أسرار.
- `area` (سلسلة، اختياري): وسم قصير يسمي جزء Claude Code المعني (مثل "hooks config" أو "/help" أو "file editing"). اتركه فارغاً إذا لم يكن واضحاً.
- `failure_mode` (سلسلة، اختياري): لتقارير سلوك النموذج، أقرب نمط فشل (مثل `instruction_following` أو `repetition_and_looping` أو `context_and_memory` أو `stopping_short` أو `other`). احذفه فقط عندما يكون التقرير خطأ منتج/أداة خالصاً.
- `task_category` (سلسلة، اختياري): ما كانت تفعله الجلسة عند وقوع المشكلة: `code_edit` أو `debug` أو `explain` أو `plan` أو `shell` أو `search` أو `review` أو `other`.

## أمثلة

### مثال 1: الإبلاغ عن خطأ منتج

```
SendFeedback(
  type="bug",
  title="/export truncates the last message",
  details="**What happened:** exported transcript is missing the final assistant message.\n**What the user said:** \"the last reply never shows up in the file\".\n**Repro:** run /export after any multi-turn session.\n**Evidence:** v2.1.233, macOS.",
  area="/export",
  task_category="other"
)
```

## ملاحظات

- لا تُدرج أبداً أسراراً أو رموز مصادقة أو بيانات مستخدم خاصة في `details`.
- انقل كلمات المستخدم حرفياً عندما تكون متاحة؛ وإلا فاذكر أن النموذج لاحظ المشكلة.
- أبقِ التقرير واقعياً — التخمين حول السبب الجذري مكانه `**Cause:**` فقط عند التحقق منه داخل الجلسة.
