# Read

## Tanım

Yerel dosya sisteminden dosya içeriğini okur. Metin dosyaları, resimler, PDF ve Jupyter notebook destekler.

## Parametreler

| Parametre | Tür | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `file_path` | string | Evet | Dosyanın mutlak yolu |
| `offset` | number | Hayır | Başlangıç satır numarası (büyük dosyalar için parçalı okuma) |
| `limit` | number | Hayır | Okunacak satır sayısı (büyük dosyalar için parçalı okuma) |
| `pages` | string | Hayır | PDF sayfa aralığı (örn. "1-5", "3", "10-20"), yalnızca PDF için |

## Kullanım Senaryoları

**Kullanıma uygun:**
- Kod dosyaları, yapılandırma dosyaları gibi metin dosyalarını okuma
- Resim dosyalarını görüntüleme (Claude çok modlu bir modeldir)
- PDF belgeleri okuma
- Jupyter notebook okuma (tüm hücreleri ve çıktıları döndürür)
- Bağlam elde etmek için birden fazla dosyayı paralel okuma

**Kullanıma uygun değil:**
- Dizin okuma — Bash'in `ls` komutu kullanılmalıdır
- Açık uçlu kod tabanı keşfi — Task (Explore türü) kullanılmalıdır

## Dikkat Edilecekler

- Yol mutlak yol olmalıdır, göreli yol kullanılamaz
- Varsayılan olarak dosyanın ilk 2000 satırını okur
- 2000 karakteri aşan satırlar kesilir
- Çıktı `cat -n` formatında, satır numaraları 1'den başlar
- Büyük PDF'ler (10 sayfadan fazla) için `pages` parametresi belirtilmelidir, her seferinde en fazla 20 sayfa
- Var olmayan bir dosyayı okumak hata döndürür (çökmez)
- Tek mesajda birden fazla Read paralel olarak çağrılabilir

## cc-viewer'da Önemi

Read çağrıları istek günlüğünde `tool_use` (çağrı) ve `tool_result` (dönen içerik) content block çifti olarak görünür. `tool_result` dosyanın gerçek içeriğini içerir ve modelin hangi dosyaları okuduğunu analiz etmek için kullanılabilir.

## Orijinal Metin

<textarea readonly>Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than 2000 characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.
- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You can call multiple tools in a single response. It is always better to speculatively read multiple potentially useful files in parallel.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.</textarea>
