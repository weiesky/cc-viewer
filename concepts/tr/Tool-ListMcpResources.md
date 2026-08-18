# ListMcpResources

Bağlı MCP sunucularının sunduğu kaynakları listeler; isteğe bağlı olarak tek bir sunucuya filtrelenir.

## Ne Zaman Kullanılır

- Okumadan önce bir MCP sunucusunun hangi kaynakları (dosyalar, kayıtlar, dokümanlar) sunduğunu keşfetmeniz gerekiyor.
- Bağlı tüm sunuculardaki kaynakların genel bir görünümünü istiyorsunuz.

## Parametreler

- `server` (string, opsiyonel): Kaynakları filtrelemek için sunucu adı. Tüm bağlı sunuculardan kaynakları listelemek için atlayın.

## Örnekler

### Örnek 1: Her şeyi listeleme

```
ListMcpResources()
```

### Örnek 2: Tek bir sunucunun kaynaklarını listeleme

```
ListMcpResources(server="github")
```

## Notlar

- Bu keşif adımıdır: ilginç URI'leri `ReadMcpResource`'a (tek kaynak) veya `ReadMcpResourceDir`'e (dizin listelemeleri) besleyin.
- Sunucular oturum ömrü boyunca bağlanır ve ayrılır; bir sunucu yeni eklendiyse yeniden listeleyin.
