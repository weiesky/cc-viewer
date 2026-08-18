# ListConnectors

Kullanıcının claude.ai organizasyonu için yüklü MCP connector'larını listeler; isteğe bağlı olarak anahtar kelimeyle filtrelenir.

## Ne Zaman Kullanılır

- Yenilerini önermeden önce hangi connector'ların zaten yüklü olduğunu bilmeniz gerekiyor.
- Kullanıcı, organizasyonlarının hangi entegrasyonlara sahip olduğunu sorar.

## Etkinleştirme

- Yalnızca birinci taraf API üzerindeki uzak (claude.ai) oturumlarda mevcuttur.

## Parametreler

- `keywords` (string dizisi, opsiyonel): Listeyi filtreleyin — en fazla 8 öğe, her biri 1–64 karakter. Her şeyi listelemek için atlayın.

## Örnekler

### Örnek 1: Yüklü tüm connector'ları listeleme

```
ListConnectors()
```

### Örnek 2: Anahtar kelimeyle filtreleme

```
ListConnectors(keywords=["github"])
```

## Notlar

- Tam bul-ve-etkinleştir akışı için `SearchMcpRegistry` (keşif) ve `SuggestConnectors` (ayrıntılar) ile eşleştirin.
