# ListConnectors

Wyświetla konektory MCP zainstalowane dla organizacji claude.ai użytkownika, opcjonalnie filtrowane po słowach kluczowych.

## Kiedy używać

- Musisz wiedzieć, które konektory są już zainstalowane, zanim zasugerujesz nowe.
- Użytkownik pyta, jakie integracje ma jego organizacja.

## Aktywacja

- Dostępne tylko w sesjach zdalnych (claude.ai) na oficjalnym API (first-party).

## Parametry

- `keywords` (tablica stringów, opcjonalny): Filtruj listę — do 8 elementów, każdy 1–64 znaki. Pomiń, aby wyświetlić wszystko.

## Przykłady

### Przykład 1: Wyświetlenie wszystkich zainstalowanych konektorów

```
ListConnectors()
```

### Przykład 2: Filtrowanie po słowie kluczowym

```
ListConnectors(keywords=["github"])
```

## Uwagi

- Łącz z `SearchMcpRegistry` (odkrywanie) i `SuggestConnectors` (szczegóły) dla pełnego przepływu znajdź-i-włącz.
