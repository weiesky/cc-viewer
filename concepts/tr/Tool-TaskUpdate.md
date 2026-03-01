# TaskUpdate

## Tanım

Görev listesindeki bir görevin durumunu, içeriğini veya bağımlılık ilişkilerini günceller.

## Parametreler

| Parametre | Tür | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `taskId` | string | Evet | Güncellenecek görev ID'si |
| `status` | enum | Hayır | Yeni durum: `pending` / `in_progress` / `completed` / `deleted` |
| `subject` | string | Hayır | Yeni başlık |
| `description` | string | Hayır | Yeni açıklama |
| `activeForm` | string | Hayır | Devam ederken gösterilen şimdiki zaman metni |
| `owner` | string | Hayır | Yeni görev sorumlusu (agent adı) |
| `metadata` | object | Hayır | Birleştirilecek meta veriler (null olarak ayarlamak anahtarı siler) |
| `addBlocks` | string[] | Hayır | Bu görev tarafından engellenen görev ID listesi |
| `addBlockedBy` | string[] | Hayır | Bu görevi engelleyen ön koşul görev ID listesi |

## Durum Geçişi

```
pending → in_progress → completed
```

`deleted` herhangi bir durumdan geçilebilir ve görevi kalıcı olarak kaldırır.

## Kullanım Senaryoları

**Kullanıma uygun:**
- Çalışmaya başlarken görevi `in_progress` olarak işaretleme
- Çalışma tamamlandığında görevi `completed` olarak işaretleme
- Görevler arası bağımlılık ilişkilerini ayarlama
- Gereksinimler değiştiğinde görev içeriğini güncelleme

**Önemli kurallar:**
- Yalnızca görev tamamen tamamlandığında `completed` olarak işaretleyin
- Hata veya engelle karşılaşıldığında `in_progress` olarak bırakın
- Test başarısız, uygulama eksik veya çözülmemiş hatalarla karşılaşıldığında `completed` olarak işaretlemeyin

## Dikkat Edilecekler

- Güncellemeden önce TaskGet ile görevin en son durumunu alın, eski verileri önleyin
- Görevi tamamladıktan sonra TaskList ile bir sonraki mevcut görevi bulun

## cc-viewer'da Önemi

TaskUpdate dahili görev yönetim işlemidir ve bağımsız API isteği üretmez.

## Orijinal Metin

<textarea readonly>Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as resolved:**
- When you have completed the work described in a task
- When a task is no longer needed or has been superseded
- IMPORTANT: Always mark your assigned tasks as resolved when you finish them
- After resolving, call TaskList to find your next task

- ONLY mark a task as completed when you have FULLY accomplished it
- If you encounter errors, blockers, or cannot finish, keep the task as in_progress
- When blocked, create a new task describing what needs to be resolved
- Never mark a task as completed if:
  - Tests are failing
  - Implementation is partial
  - You encountered unresolved errors
  - You couldn't find necessary files or dependencies

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to `deleted` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- **status**: The task status (see Status Workflow below)
- **subject**: Change the task title (imperative form, e.g., "Run tests")
- **description**: Change the task description
- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")
- **owner**: Change the task owner (agent name)
- **metadata**: Merge metadata keys into the task (set a key to null to delete it)
- **addBlocks**: Mark tasks that cannot start until this one completes
- **addBlockedBy**: Mark tasks that must complete before this one can start

## Status Workflow

Status progresses: `pending` → `in_progress` → `completed`

Use `deleted` to permanently remove a task.

## Staleness

Make sure to read a task's latest state using `TaskGet` before updating it.

## Examples

Mark task as in progress when starting work:
```json
{"taskId": "1", "status": "in_progress"}
```

Mark task as completed after finishing work:
```json
{"taskId": "1", "status": "completed"}
```

Delete a task:
```json
{"taskId": "1", "status": "deleted"}
```

Claim a task by setting owner:
```json
{"taskId": "1", "owner": "my-name"}
```

Set up task dependencies:
```json
{"taskId": "2", "addBlockedBy": ["1"]}
```
</textarea>
