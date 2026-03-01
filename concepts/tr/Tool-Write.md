# Write

## Tanım

İçeriği yerel dosya sistemine yazar. Dosya zaten mevcutsa üzerine yazar.

## Parametreler

| Parametre | Tür | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `file_path` | string | Evet | Dosyanın mutlak yolu (mutlak yol olmalıdır) |
| `content` | string | Evet | Yazılacak içerik |

## Kullanım Senaryoları

**Kullanıma uygun:**
- Yeni dosya oluşturma
- Dosya içeriğinin tamamen yeniden yazılması gerektiğinde

**Kullanıma uygun değil:**
- Dosyadaki kısmi içeriği değiştirme — Edit kullanılmalıdır
- Kullanıcı açıkça istemediği sürece proaktif olarak belge dosyaları (*.md) veya README oluşturulmamalıdır

## Dikkat Edilecekler

- Hedef dosya zaten mevcutsa, önce Read ile okunmuş olmalıdır, aksi takdirde başarısız olur
- Mevcut dosyanın tüm içeriğini üzerine yazar
- Mevcut dosyaları düzenlemek için Edit'i tercih edin; Write yalnızca yeni dosya oluşturma veya tamamen yeniden yazma için kullanılır

## cc-viewer'da Önemi

Write çağrıları istek günlüğünde `tool_use` content block olarak görünür; `input.content` yazılan tam içeriği içerir.

## Orijinal Metin

<textarea readonly>Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.</textarea>
