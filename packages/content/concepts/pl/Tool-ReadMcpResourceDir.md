# ReadMcpResourceDir

Wyświetla wpisy katalogowego zasobu udostępnianego przez podłączony serwer MCP, adresowanego jego URI.

## Kiedy używać

- Serwer MCP organizuje zasoby hierarchicznie, a Ty musisz wyliczyć jeden poziom tej hierarchii.
- Chcesz przeglądać, zanim odczytasz poszczególne zasoby za pomocą `ReadMcpResource`.

## Aktywacja

- Zawsze włączone, ale nieujawniane na liście narzędzi modelu — przeznaczone do użytku w cienkim kliencie / sidecar.

## Parametry

- `server` (string, wymagany): Nazwa serwera MCP.
- `uri` (string, wymagany): URI zasobu katalogu do wyświetlenia.

## Przykłady

### Przykład 1: Wyświetlenie katalogu zasobów

```
ReadMcpResourceDir(server="filesystem", uri="file:///project/src/")
```

Zwraca wpisy potomne, które serwer udostępnia pod tym URI katalogu.

## Uwagi

- Obsługują to tylko serwery modelujące swoje zasoby jako katalogi; serwery płaskie zwrócą błąd lub puste listowanie — wróć wtedy do `ListMcpResources`.
- Łącz z `ReadMcpResource`, aby wgłębić się we wpisy, które wyglądają na istotne.
