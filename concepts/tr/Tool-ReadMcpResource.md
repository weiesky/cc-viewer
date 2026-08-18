# ReadMcpResource

Bağlı bir MCP (Model Context Protocol) sunucusunun sunduğu tek bir kaynağı URI'siyle adresleyerek okur.

## Ne Zaman Kullanılır

- Bir MCP sunucusu, içeriğine bağlamda ihtiyaç duyduğunuz bir kaynak (dosya, kayıt, doküman) reklam eder.
- Somut bir kaynak URI'niz var — `ListMcpResources`'tan, sunucunun dokümantasyonundan veya önceki bir araç sonucundan.

## Parametreler

- `server` (string, zorunlu): MCP sunucusunun adı.
- `uri` (string, zorunlu): Okunacak kaynak URI'si.

## Örnekler

### Örnek 1: Bir sunucu kaynağını URI ile okumak

```
ReadMcpResource(server="github", uri="file:///repo/docs/architecture.md")
```

Kaynak içeriğini `github` MCP sunucusunun sağladığı hâliyle döndürür.

## Notlar

- Bir sunucunun hangi kaynakları sunduğunu bilmiyorsanız önce `ListMcpResources` kullanın; dizin tarzı listelemeler için `ReadMcpResourceDir` kullanın.
- URI şeması sunucuya özgüdür (`file://`, `https://`, özel şemalar) — hedef sunucunun ne reklam ettiğini kontrol edin.
