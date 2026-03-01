# TaskStop

## Tanım

Çalışan bir arka plan görevini durdurur.

## Parametreler

| Parametre | Tür | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `task_id` | string | Hayır | Durdurulacak arka plan görev ID'si |
| `shell_id` | string | Hayır | Kullanımdan kaldırıldı, `task_id` kullanın |

## Kullanım Senaryoları

**Kullanıma uygun:**
- Artık gerekli olmayan uzun süreli görevleri sonlandırma
- Yanlışlıkla başlatılan arka plan görevlerini iptal etme

## Dikkat Edilecekler

- Başarı veya başarısızlık durumu döndürür
- `shell_id` parametresi kullanımdan kaldırılmıştır, `task_id` kullanılmalıdır

## cc-viewer'da Önemi

TaskStop çağrısı kendisi API isteği üretmez; Claude Code'un dahili görev yönetim işlemidir.

## Orijinal Metin

<textarea readonly>
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
</textarea>
