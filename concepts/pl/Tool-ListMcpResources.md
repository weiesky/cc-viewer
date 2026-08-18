# ListMcpResources

Wyświetla zasoby udostępniane przez podłączone serwery MCP, opcjonalnie filtrowane do jednego serwera.

## Kiedy używać

- Musisz odkryć, jakie zasoby (pliki, rekordy, dokumenty) oferuje serwer MCP, zanim je odczytasz.
- Chcesz przegląd wszystkich zasobów ze wszystkich podłączonych serwerów.

## Parametry

- `server` (string, opcjonalny): Nazwa serwera, według której filtrować zasoby. Pomiń, aby wyświetlić zasoby ze wszystkich podłączonych serwerów.

## Przykłady

### Przykład 1: Wyświetlenie wszystkiego

```
ListMcpResources()
```

### Przykład 2: Wyświetlenie zasobów jednego serwera

```
ListMcpResources(server="github")
```

## Uwagi

- To krok odkrywania: przekazuj interesujące URI do `ReadMcpResource` (pojedynczy zasób) lub `ReadMcpResourceDir` (listowania katalogów).
- Serwery łączą się i rozłączają w trakcie życia sesji; wyświetl ponownie listę, jeśli serwer został właśnie dodany.
