# TaskList

## Tanım

Görev listesindeki tüm görevleri listeler, genel ilerlemeyi ve mevcut çalışmaları görüntüler.

## Parametreler

Parametre yok.

## Dönen İçerik

Her görevin özet bilgileri:
- `id` — Görev tanımlayıcısı
- `subject` — Kısa açıklama
- `status` — Durum: `pending`, `in_progress` veya `completed`
- `owner` — Sorumlu kişi (agent ID), boş ise atanmamış
- `blockedBy` — Bu görevi engelleyen tamamlanmamış görev ID listesi

## Kullanım Senaryoları

**Kullanıma uygun:**
- Mevcut görevleri görme (durumu pending, owner'ı yok, engellenmemiş)
- Proje genel ilerlemesini kontrol etme
- Engellenen görevleri bulma
- Bir görevi tamamladıktan sonra bir sonrakini bulma

## Dikkat Edilecekler

- Görevleri ID sırasına göre işlemeyi tercih edin (en küçük ID önce), çünkü erken görevler genellikle sonraki görevler için bağlam sağlar
- `blockedBy` olan görevler bağımlılık çözülmeden sahiplenilemez
- Belirli bir görevin tam detayları için TaskGet kullanın

## cc-viewer'da Önemi

TaskList dahili görev yönetim işlemidir ve bağımsız API isteği üretmez.

## Orijinal Metin

<textarea readonly>Use this tool to list all tasks in the task list.

## When to Use This Tool

- To see what tasks are available to work on (status: 'pending', no owner, not blocked)
- To check overall progress on the project
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work or claim the next available task
- **Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available, as earlier tasks often set up context for later ones

## Output

Returns a summary of each task:
- **id**: Task identifier (use with TaskGet, TaskUpdate)
- **subject**: Brief description of the task
- **status**: 'pending', 'in_progress', or 'completed'
- **owner**: Agent ID if assigned, empty if available
- **blockedBy**: List of open task IDs that must be resolved first (tasks with blockedBy cannot be claimed until dependencies resolve)

Use TaskGet with a specific task ID to view full details including description and comments.
</textarea>
