# ReadMcpResourceDir

Bağlı bir MCP sunucusunun sunduğu dizin tarzı bir kaynağın girdilerini URI'siyle adresleyerek listeler.

## Ne Zaman Kullanılır

- Bir MCP sunucusu kaynakları hiyerarşik olarak düzenler ve bu hiyerarşinin bir düzeyini saymanız gerekir.
- Bireysel kaynakları `ReadMcpResource` ile okumadan önce göz atmak istiyorsunuz.

## Etkinleştirme

- Her zaman etkindir, ancak modelin araç listesine sunulmaz — ince istemci / sidecar kullanımı için tasarlanmıştır.

## Parametreler

- `server` (string, zorunlu): MCP sunucusunun adı.
- `uri` (string, zorunlu): Listelenecek dizin kaynağı URI'si.

## Örnekler

### Örnek 1: Bir kaynak dizinini listeleme

```
ReadMcpResourceDir(server="filesystem", uri="file:///project/src/")
```

Sunucunun o dizin URI'si altında sunduğu alt girdileri döndürür.

## Notlar

- Yalnızca kaynaklarını dizinler olarak modelleyen sunucular bunu destekler; düz sunucular bir hata veya boş bir listeleme döndürür — `ListMcpResources`'a geri dönün.
- İlgili görünen girdilere inmek için `ReadMcpResource` ile birleştirin.
