# NotebookEdit

## Tanım

Jupyter notebook (.ipynb dosyası) içindeki belirli bir hücreyi değiştirme, ekleme veya silme işlemi yapar.

## Parametreler

| Parametre | Tür | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `notebook_path` | string | Evet | Notebook dosyasının mutlak yolu |
| `new_source` | string | Evet | Hücrenin yeni içeriği |
| `cell_id` | string | Hayır | Düzenlenecek hücre ID'si. Ekleme modunda yeni hücre bu ID'den sonra eklenir |
| `cell_type` | enum | Hayır | Hücre türü: `code` veya `markdown`. Ekleme modunda zorunludur |
| `edit_mode` | enum | Hayır | Düzenleme modu: `replace` (varsayılan), `insert`, `delete` |

## Kullanım Senaryoları

**Kullanıma uygun:**
- Jupyter notebook'taki kod veya markdown hücrelerini değiştirme
- Notebook'a yeni hücre ekleme
- Notebook'tan hücre silme

## Dikkat Edilecekler

- `cell_number` 0 indekslidir
- `insert` modu belirtilen konuma yeni hücre ekler
- `delete` modu belirtilen konumdaki hücreyi siler
- Yol mutlak yol olmalıdır

## cc-viewer'da Önemi

NotebookEdit çağrıları istek günlüğünde `tool_use` content block olarak görünür ve notebook üzerindeki belirli değişiklik işlemlerini kaydeder.

## Orijinal Metin

<textarea readonly>Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source. Jupyter notebooks are interactive documents that combine code, text, and visualizations, commonly used for data analysis and scientific computing. The notebook_path parameter must be an absolute path, not a relative path. The cell_number is 0-indexed. Use edit_mode=insert to add a new cell at the index specified by cell_number. Use edit_mode=delete to delete the cell at the index specified by cell_number.</textarea>
