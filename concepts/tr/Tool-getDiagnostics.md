# getDiagnostics (mcp__ide__getDiagnostics)

## Tanım

VS Code'dan sözdizimi hataları, tür hataları, lint uyarıları gibi dil tanılama bilgilerini alır.

## Parametreler

| Parametre | Tür | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `uri` | string | Hayır | Dosya URI'si. Belirtilmezse tüm dosyaların tanılama bilgilerini alır |

## Kullanım Senaryoları

**Kullanıma uygun:**
- Kodun sözdizimi, tür, lint gibi anlamsal sorunlarını kontrol etme
- Kod düzenledikten sonra yeni hata oluşup oluşmadığını doğrulama
- Kod kalitesini kontrol etmek için Bash komutlarının yerine kullanma

**Kullanıma uygun değil:**
- Test çalıştırma — Bash kullanılmalıdır
- Çalışma zamanı hatalarını kontrol etme — kodu çalıştırmak için Bash kullanılmalıdır

## Dikkat Edilecekler

- Bu bir MCP (Model Context Protocol) aracıdır ve IDE entegrasyonu tarafından sağlanır
- Yalnızca VS Code / IDE ortamında kullanılabilir
- Kod sorunlarını kontrol etmek için Bash komutları yerine bu aracı tercih edin

## cc-viewer'da Önemi

getDiagnostics bir MCP aracıdır ve istek günlüğünün `tools` dizisinde `mcp__ide__getDiagnostics` adıyla görünür. Çağrıları ve dönüşleri standart `tool_use` / `tool_result` kalıbını izler. MCP araçlarının eklenmesi veya kaldırılması tools dizisinin değişmesine neden olur ve önbellek yeniden oluşturmayı tetikleyebilir.

## Orijinal Metin

<textarea readonly>Get language diagnostics from VS Code</textarea>
