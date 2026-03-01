# TaskCreate

## Tanım

İlerlemeyi izlemek, karmaşık görevleri organize etmek ve kullanıcıya çalışma ilerlemesini göstermek için yapılandırılmış görev listesi girdisi oluşturur.

## Parametreler

| Parametre | Tür | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `subject` | string | Evet | Kısa görev başlığı, emir kipi kullanılır (örn. "Fix authentication bug") |
| `description` | string | Evet | Bağlam ve kabul kriterleri dahil ayrıntılı açıklama |
| `activeForm` | string | Hayır | Devam ederken gösterilen şimdiki zaman metni (örn. "Fixing authentication bug") |
| `metadata` | object | Hayır | Göreve eklenen rastgele meta veriler |

## Kullanım Senaryoları

**Kullanıma uygun:**
- Karmaşık çok adımlı görevler (3 adımdan fazla)
- Kullanıcı birden fazla yapılacak iş sağladığında
- Planlama modunda çalışmayı izleme
- Kullanıcı açıkça todo listesi kullanılmasını istediğinde

**Kullanıma uygun değil:**
- Tek basit görev
- 3 adımdan az basit işlemler
- Salt konuşma veya bilgi sorgusu

## Dikkat Edilecekler

- Tüm yeni görevlerin başlangıç durumu `pending`'dir
- `subject` emir kipi kullanır ("Run tests"), `activeForm` şimdiki zaman kullanır ("Running tests")
- Oluşturulduktan sonra TaskUpdate ile bağımlılık ilişkileri (blocks/blockedBy) ayarlanabilir
- Oluşturmadan önce TaskList ile mükerrer görev olup olmadığı kontrol edilmelidir

## cc-viewer'da Önemi

TaskCreate, Claude Code'un dahili görev yönetim işlemidir ve bağımsız API isteği üretmez. Ancak Chat Mode'da modelin bu aracı çağırdığı tool_use block görülebilir.

## Orijinal Metin

<textarea readonly>Use this tool to create a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool

Use this tool proactively in these scenarios:

- Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
- Plan mode - When using plan mode, create a task list to track the work
- User explicitly requests todo list - When the user directly asks you to use the todo list
- User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
- After receiving new instructions - Immediately capture user requirements as tasks
- When you start working on a task - Mark it as in_progress BEFORE beginning work
- After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
- There is only a single, straightforward task
- The task is trivial and tracking it provides no organizational benefit
- The task can be completed in less than 3 trivial steps
- The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Task Fields

- **subject**: A brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow")
- **description**: Detailed description of what needs to be done, including context and acceptance criteria
- **activeForm**: Present continuous form shown in spinner when task is in_progress (e.g., "Fixing authentication bug"). This is displayed to the user while you work on the task.

**IMPORTANT**: Always provide activeForm when creating tasks. The subject should be imperative ("Run tests") while activeForm should be present continuous ("Running tests"). All tasks are created with status `pending`.

## Tips

- Create tasks with clear, specific subjects that describe the outcome
- Include enough detail in the description for another agent to understand and complete the task
- After creating tasks, use TaskUpdate to set up dependencies (blocks/blockedBy) if needed
- Check TaskList first to avoid creating duplicate tasks
</textarea>
