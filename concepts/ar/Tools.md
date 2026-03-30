# نظرة عامة على أدوات Claude Code

يوفر Claude Code مجموعة من الأدوات المدمجة للنموذج عبر آلية tool_use في Anthropic API. تحتوي مصفوفة `tools` في كل طلب MainAgent على تعريفات JSON Schema الكاملة لهذه الأدوات، ويستدعيها النموذج في الاستجابة عبر كتل محتوى `tool_use`.

فيما يلي فهرس مصنف لجميع الأدوات.

## نظام الوكلاء

| الأداة | الغرض |
|--------|--------|
| [Task](Tool-Task.md) | بدء وكيل فرعي (SubAgent) لمعالجة المهام المعقدة متعددة الخطوات |
| [TaskOutput](Tool-TaskOutput.md) | الحصول على مخرجات المهام الخلفية |
| [TaskStop](Tool-TaskStop.md) | إيقاف مهمة خلفية قيد التشغيل |
| [TaskCreate](Tool-TaskCreate.md) | إنشاء عنصر في قائمة المهام المنظمة |
| [TaskGet](Tool-TaskGet.md) | الحصول على تفاصيل المهمة |
| [TaskUpdate](Tool-TaskUpdate.md) | تحديث حالة المهمة والتبعيات وغيرها |
| [TaskList](Tool-TaskList.md) | عرض جميع المهام |

## عمليات الملفات

| الأداة | الغرض |
|--------|--------|
| [Read](Tool-Read.md) | قراءة محتوى الملفات (يدعم النصوص والصور وPDF وJupyter notebook) |
| [Edit](Tool-Edit.md) | تحرير الملفات عبر استبدال نصي دقيق |
| [Write](Tool-Write.md) | كتابة أو الكتابة فوق الملفات |
| [NotebookEdit](Tool-NotebookEdit.md) | تحرير خلايا Jupyter notebook |

## البحث

| الأداة | الغرض |
|--------|--------|
| [Glob](Tool-Glob.md) | البحث عن الملفات بمطابقة أنماط أسماء الملفات |
| [Grep](Tool-Grep.md) | البحث في محتوى الملفات باستخدام ripgrep |

## الطرفية

| الأداة | الغرض |
|--------|--------|
| [Bash](Tool-Bash.md) | تنفيذ أوامر shell |

## الويب

| الأداة | الغرض |
|--------|--------|
| [WebFetch](Tool-WebFetch.md) | جلب محتوى صفحات الويب ومعالجته بالذكاء الاصطناعي |
| [WebSearch](Tool-WebSearch.md) | استعلامات محرك البحث |

## التخطيط والتفاعل

| الأداة | الغرض |
|--------|--------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | الدخول في وضع التخطيط لتصميم خطة التنفيذ |
| [ExitPlanMode](Tool-ExitPlanMode.md) | الخروج من وضع التخطيط وتقديم الخطة لموافقة المستخدم |
| [AskUserQuestion](Tool-AskUserQuestion.md) | طرح أسئلة على المستخدم للتوضيح أو اتخاذ القرارات |

## الإضافات

| الأداة | الغرض |
|--------|--------|
| [Skill](Tool-Skill.md) | تنفيذ المهارات (slash command) |

## تكامل IDE

| الأداة | الغرض |
|--------|--------|
| [getDiagnostics](Tool-getDiagnostics.md) | الحصول على معلومات التشخيص اللغوي من VS Code |
| [executeCode](Tool-executeCode.md) | تنفيذ الكود في Jupyter kernel |
