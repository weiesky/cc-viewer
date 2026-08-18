# ReadMcpResource

Odczytuje pojedynczy zasób udostępniany przez podłączony serwer MCP (Model Context Protocol), adresowany jego URI.

## Kiedy używać

- Serwer MCP reklamuje zasób (plik, rekord, dokument), którego zawartość potrzebujesz w kontekście.
- Masz konkretny URI zasobu — z `ListMcpResources`, z dokumentacji serwera lub z poprzedniego wyniku narzędzia.

## Parametry

- `server` (string, wymagany): Nazwa serwera MCP.
- `uri` (string, wymagany): URI zasobu do odczytu.

## Przykłady

### Przykład 1: Odczyt zasobu serwera po URI

```
ReadMcpResource(server="github", uri="file:///repo/docs/architecture.md")
```

Zwraca zawartość zasobu dostarczoną przez serwer MCP `github`.

## Uwagi

- Użyj najpierw `ListMcpResources`, jeśli nie wiesz, jakie zasoby udostępnia serwer; użyj `ReadMcpResourceDir` dla listowań w stylu katalogu.
- Schemat URI jest specyficzny dla serwera (`file://`, `https://`, schematy własne) — sprawdź, co reklamuje serwer docelowy.
