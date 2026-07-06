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

## Orijinal Metin

<textarea readonly>Get language diagnostics from VS Code</textarea>
