# Glob

## Tanım

Herhangi bir boyuttaki kod tabanını destekleyen hızlı dosya adı kalıp eşleştirme aracı. Değişiklik zamanına göre sıralanmış eşleşen dosya yollarını döndürür.

## Parametreler

| Parametre | Tür | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `pattern` | string | Evet | glob kalıbı (örn. `**/*.js`, `src/**/*.ts`) |
| `path` | string | Hayır | Arama dizini, varsayılan olarak mevcut çalışma dizini. "undefined" veya "null" geçmeyin |

## Kullanım Senaryoları

**Kullanıma uygun:**
- Dosya adı kalıbına göre dosya bulma
- Belirli türdeki tüm dosyaları bulma (örn. tüm `.tsx` dosyaları)
- Belirli sınıf tanımını (örn. `class Foo`) ararken önce dosyayı konumlandırma
- Tek mesajda paralel olarak birden fazla Glob çağrısı yapılabilir

**Kullanıma uygun değil:**
- Dosya içeriği arama — Grep kullanılmalıdır
- Birden fazla tur gerektiren açık uçlu keşif — Task (Explore türü) kullanılmalıdır

## Dikkat Edilecekler

- Standart glob sözdizimini destekler: `*` tek seviye, `**` çok seviye, `{}` çoklu seçim eşleştirir
- Sonuçlar değişiklik zamanına göre sıralanır
- Bash'in `find` komutundan daha çok önerilir

## cc-viewer'da Önemi

Glob çağrıları istek günlüğünde `tool_use` / `tool_result` content block çifti olarak görünür. `tool_result` eşleşen dosya yollarının listesini içerir.

## Orijinal Metin

<textarea readonly>- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
- You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.</textarea>
