# SuggestConnectors

Kullanıcıya etkinleştirebileceği somut connector'lar sunulabilmesi için `SearchMcpRegistry` tarafından döndürülen `directoryUuid` değerlerine karşılık gelen tam connector veri yüklerini çözer.

## Ne Zaman Kullanılır

- `SearchMcpRegistry` aday connector'lar döndürdükten sonra, sunum için tam ayrıntılarını getirmek amacıyla.

## Etkinleştirme

- Yalnızca birinci taraf API üzerindeki uzak (claude.ai) oturumlarda mevcuttur.

## Parametreler

- `uuids` (string dizisi, zorunlu): Çözülecek `directoryUuid` veya `server_id` değerleri. 1–32 öğe, her biri 1–64 karakter.

## Örnekler

### Örnek 1: İki kayıt defteri isabetini çözmek

```
SuggestConnectors(uuids=["d290f1ee-6c54-4b01-90e6-d701748f0851", "a1b2c3d4-0000-4000-8000-abcdefabcdef"])
```

## Notlar

- UUID'leri asla tahmin etmeyin — yalnızca `SearchMcpRegistry`'den dönen tanımlayıcıları çözün.
- Araç kendisi hiçbir şey bağlamaz; bir connector'ı etkinleştirmek bu aracın dışında gerçekleşir.
