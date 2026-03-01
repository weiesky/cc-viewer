# TaskGet

## Tanım

Görev ID'si ile görevin tam detaylarını alır.

## Parametreler

| Parametre | Tür | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `taskId` | string | Evet | Alınacak görev ID'si |

## Dönen İçerik

- `subject` — Görev başlığı
- `description` — Ayrıntılı gereksinimler ve bağlam
- `status` — Durum: `pending`, `in_progress` veya `completed`
- `blocks` — Bu görev tarafından engellenen görev listesi
- `blockedBy` — Bu görevi engelleyen ön koşul görev listesi

## Kullanım Senaryoları

**Kullanıma uygun:**
- Çalışmaya başlamadan önce görevin tam açıklamasını ve bağlamını alma
- Görev bağımlılıklarını anlama
- Görev atandıktan sonra tam gereksinimleri alma

## Dikkat Edilecekler

- Görevi aldıktan sonra çalışmaya başlamadan önce `blockedBy` listesinin boş olup olmadığı kontrol edilmelidir
- Tüm görevlerin özet bilgilerini görmek için TaskList kullanın

## cc-viewer'da Önemi

TaskGet dahili görev yönetim işlemidir ve bağımsız API isteği üretmez.

## Orijinal Metin

<textarea readonly>Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- **subject**: Task title
- **description**: Detailed requirements and context
- **status**: 'pending', 'in_progress', or 'completed'
- **blocks**: Tasks waiting on this one to complete
- **blockedBy**: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its blockedBy list is empty before beginning work.
- Use TaskList to see all tasks in summary form.
</textarea>
