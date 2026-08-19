# SuggestConnectors

Rozwiązuje pełne ładunki konektorów dla wartości `directoryUuid` zwróconych przez `SearchMcpRegistry`, aby użytkownikowi można było zaoferować konkretne konektory do włączenia.

## Kiedy używać

- Po tym, jak `SearchMcpRegistry` zwróci konektory kandydujące, aby pobrać ich pełne szczegóły do prezentacji.

## Aktywacja

- Dostępne tylko w sesjach zdalnych (claude.ai) na oficjalnym API (first-party).

## Parametry

- `uuids` (tablica stringów, wymagany): Wartości `directoryUuid` lub `server_id` do rozwiązania. 1–32 elementy, każdy 1–64 znaki.

## Przykłady

### Przykład 1: Rozwiązanie dwóch trafień z rejestru

```
SuggestConnectors(uuids=["d290f1ee-6c54-4b01-90e6-d701748f0851", "a1b2c3d4-0000-4000-8000-abcdefabcdef"])
```

## Uwagi

- Nigdy nie zgaduj UUID-ów — rozwiązuj tylko identyfikatory, które wróciły z `SearchMcpRegistry`.
- Narzędzie samo niczego nie łączy; włączenie konektora odbywa się poza tym przepływem.
