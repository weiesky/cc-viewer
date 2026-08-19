# تلوث السياق في Translate API

## الخلفية

يتضمن CC-Viewer ميزة ترجمة مدمجة (`POST /api/translate`) تعمل بواسطة Anthropic Messages API. في التنفيذ المبكر، كانت طلبات الترجمة تعيد استخدام بيانات المصادقة المخزنة مؤقتاً من جلسة Claude Code — بما في ذلك رؤوس `x-api-key` و `authorization`. تسبب هذا في مشكلة خفية لكنها خطيرة: كانت نتائج الترجمة تعيد في كثير من الأحيان محتوى غير ذي صلة.

## السبب الجذري

### الفرق الجوهري بين طريقتي المصادقة

يدعم Anthropic API طريقتين للمصادقة:

| الطريقة | الرأس | المصدر النموذجي | الخصائص |
|---------|-------|-----------------|---------|
| مفتاح API | `x-api-key: sk-ant-...` | متغير البيئة / Console | عديم الحالة، كل طلب مستقل |
| رمز OAuth | `authorization: Bearer sessionToken` | تسجيل دخول اشتراك Claude Code | مرتبط بالجلسة، يحتفظ الخادم بارتباط السياق |

الفرق الجوهري: **مفاتيح API عديمة الحالة** — كل طلب مستقل تماماً؛ بينما **رموز جلسة OAuth ذات حالة** — يربط خادم Anthropic الطلبات التي تستخدم نفس الرمز بنفس سياق الجلسة.

### سلسلة التلوث

عندما يستخدم Claude Code تسجيل دخول OAuth بالاشتراك، يبدو تدفق المصادقة كالتالي:

```
المحادثة الرئيسية لـ Claude Code ──(authorization: Bearer sessionToken)──→ Anthropic API
                                                                              ↑
طلب ترجمة CC-Viewer ──(authorization: Bearer sessionToken)──→ Anthropic API
```

نظراً لأن طلبات الترجمة أعادت استخدام نفس رمز الجلسة، فقد يربط خادم Anthropic طلبات الترجمة بسياق المحادثة الرئيسية لـ Claude Code. يؤدي هذا إلى:

1. **تأثر نتائج الترجمة بسياق المحادثة الرئيسية**: موجه النظام لطلب الترجمة هو "أنت مترجم"، لكن سياق الخادم لا يزال يحتوي على سجل محادثات Claude Code، مما قد يتداخل مع النموذج
2. **تعطل المحادثة الرئيسية بسبب طلبات الترجمة**: قد يتم حقن محتوى طلبات الترجمة (أجزاء نصوص واجهة المستخدم) في سياق المحادثة الرئيسية، مما يتسبب في انحراف استجابات Claude Code
3. **سلوك غير متوقع**: نظراً لأن تلوث السياق هو سلوك من جانب الخادم، لا يمكن للعميل اكتشافه أو التحكم فيه

## الدروس المستفادة

- **رموز جلسة OAuth ليست "مجرد مفتاح API آخر"** — فهي تحمل حالة من جانب الخادم، وإعادة استخدامها تعني مشاركة السياق
- **يجب أن تستخدم استدعاءات الخدمات الداخلية مصادقة مستقلة وعديمة الحالة** لتجنب الارتباط بجلسات المستخدمين

## المراجع

- [Anthropic API Authentication Docs](https://docs.anthropic.com/en/api/getting-started)
- [Claude Code Authentication](https://support.claude.com/en/articles/12304248-managing-api-key-environment-variables-in-claude-code)
- [Anthropic Bans Subscription OAuth in Third-Party Apps](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)
- [Claude Code Authentication: API Keys, Subscriptions, and SSO](https://developertoolkit.ai/en/claude-code/quick-start/authentication/)
