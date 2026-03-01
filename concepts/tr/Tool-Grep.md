# Grep

## Tanım

ripgrep tabanlı güçlü içerik arama aracı. Düzenli ifadeler, dosya türü filtreleme ve çoklu çıktı modlarını destekler.

## Parametreler

| Parametre | Tür | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `pattern` | string | Evet | Düzenli ifade arama kalıbı |
| `path` | string | Hayır | Arama yolu (dosya veya dizin), varsayılan mevcut çalışma dizini |
| `glob` | string | Hayır | Dosya adı filtresi (örn. `*.js`, `*.{ts,tsx}`) |
| `type` | string | Hayır | Dosya türü filtresi (örn. `js`, `py`, `rust`), glob'dan daha verimli |
| `output_mode` | enum | Hayır | Çıktı modu: `files_with_matches` (varsayılan), `content`, `count` |
| `-i` | boolean | Hayır | Büyük/küçük harf duyarsız arama |
| `-n` | boolean | Hayır | Satır numaralarını göster (yalnızca content modu), varsayılan true |
| `-A` | number | Hayır | Eşleşmeden sonra gösterilecek satır sayısı |
| `-B` | number | Hayır | Eşleşmeden önce gösterilecek satır sayısı |
| `-C` / `context` | number | Hayır | Eşleşme öncesi ve sonrası gösterilecek satır sayısı |
| `head_limit` | number | Hayır | Çıktı girdi sayısını sınırla, varsayılan 0 (sınırsız) |
| `offset` | number | Hayır | İlk N sonucu atla |
| `multiline` | boolean | Hayır | Çok satırlı eşleştirme modunu etkinleştir, varsayılan false |

## Kullanım Senaryoları

**Kullanıma uygun:**
- Kod tabanında belirli dize veya kalıp arama
- Fonksiyon/değişken kullanım yerlerini bulma
- Dosya türüne göre arama sonuçlarını filtreleme
- Eşleşme sayısını sayma

**Kullanıma uygun değil:**
- Dosya adına göre dosya bulma — Glob kullanılmalıdır
- Birden fazla tur gerektiren açık uçlu keşif — Task (Explore türü) kullanılmalıdır

## Dikkat Edilecekler

- ripgrep sözdizimi kullanır (grep değil), süslü parantez gibi özel karakterler kaçış gerektirir
- `files_with_matches` modu yalnızca dosya yollarını döndürür, en verimli moddur
- `content` modu eşleşen satır içeriklerini döndürür, bağlam satırlarını destekler
- Çok satırlı eşleştirme için `multiline: true` ayarlanmalıdır
- Bash'teki `grep` veya `rg` komutu yerine her zaman Grep aracını tercih edin

## cc-viewer'da Önemi

Grep çağrıları istek günlüğünde `tool_use` / `tool_result` content block çifti olarak görünür. `tool_result` arama sonuçlarını içerir.

## Orijinal Metin

<textarea readonly>A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command. The Grep tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\s+\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
  - Use Agent tool for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use `interface\{\}` to find `interface{}` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like `struct \{[\s\S]*?field`, use `multiline: true`
</textarea>
