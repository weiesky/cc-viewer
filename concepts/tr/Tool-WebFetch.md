# WebFetch

## Tanım

Belirtilen URL'nin web sayfası içeriğini çeker, HTML'yi markdown'a dönüştürür ve prompt'a göre AI modeli ile içeriği işler.

## Parametreler

| Parametre | Tür | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `url` | string (URI) | Evet | Çekilecek tam URL |
| `prompt` | string | Evet | Sayfadan hangi bilginin çıkarılacağını açıklar |

## Kullanım Senaryoları

**Kullanıma uygun:**
- Herkese açık web sayfalarının içeriğini alma
- Çevrimiçi belgelere başvurma
- Web sayfasından belirli bilgileri çıkarma

**Kullanıma uygun değil:**
- Kimlik doğrulama gerektiren URL'ler (Google Docs, Confluence, Jira, GitHub vb.) — önce özel MCP aracı aranmalıdır
- GitHub URL'leri — öncelikle `gh` CLI kullanılmalıdır

## Dikkat Edilecekler

- URL tam ve geçerli bir URL olmalıdır
- HTTP otomatik olarak HTTPS'ye yükseltilir
- İçerik çok büyükse sonuçlar özetlenebilir
- 15 dakikalık otomatik temizlenen önbellek içerir
- URL farklı bir ana bilgisayara yönlendirildiğinde, araç yönlendirme URL'sini döndürür ve yeni URL ile tekrar istek yapılması gerekir
- MCP tarafından sağlanan web fetch aracı mevcutsa, onu tercih edin

## cc-viewer'da Önemi

WebFetch çağrıları istek günlüğünde `tool_use` / `tool_result` content block çifti olarak görünür. `tool_result` AI tarafından işlenmiş web sayfası içerik özetini içerir.

## Orijinal Metin

<textarea readonly>IMPORTANT: WebFetch WILL FAIL for authenticated or private URLs. Before using this tool, check if the URL points to an authenticated service (e.g. Google Docs, Confluence, Jira, GitHub). If so, you MUST use ToolSearch first to find a specialized tool that provides authenticated access.

- Fetches content from a specified URL and processes it using an AI model
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Processes the content with the prompt using a small, fast model
- Returns the model's response about the content
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead of this one, as it may have fewer restrictions.
  - The URL must be a fully-formed valid URL
  - HTTP URLs will be automatically upgraded to HTTPS
  - The prompt should describe what information you want to extract from the page
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large
  - Includes a self-cleaning 15-minute cache for faster responses when repeatedly accessing the same URL
  - When a URL redirects to a different host, the tool will inform you and provide the redirect URL in a special format. You should then make a new WebFetch request with the redirect URL to fetch the content.
  - For GitHub URLs, prefer using the gh CLI via Bash instead (e.g., gh pr view, gh issue view, gh api).
</textarea>
