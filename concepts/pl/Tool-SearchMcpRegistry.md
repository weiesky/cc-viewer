# SearchMcpRegistry

Przeszukuje rejestr konektorów MCP po słowach kluczowych, aby odkryć konektory, które mogą pomóc w ukończeniu zadania.

## Kiedy używać

- Zadanie skorzystałoby na usłudze zewnętrznej (bazie danych, trackerze zgłoszeń, API SaaS), a Ty chcesz sprawdzić, czy istnieje dla niej konektor MCP.
- Użytkownik wymienia produkt i prosi o jego podłączenie — przeszukaj rejestr w poszukiwaniu pasującego konektora.

## Parametry

- `keywords` (tablica stringów, wymagany): Frazy kluczowe opisujące intencję użytkownika lub wymieniony produkt. 1–8 elementów, każdy 1–64 znaki.

## Przykłady

### Przykład 1: Znalezienie konektora dla wymienionego produktu

```
SearchMcpRegistry(keywords=["linear", "issue tracker"])
```

Zwraca wpisy rejestru, których konektory pasują do słów kluczowych. Pełne szczegóły konektorów pobierz za pomocą `SuggestConnectors`.

## Uwagi

- Tylko do odczytu i bezpieczne przy współbieżności; wyniki mają ograniczony rozmiar.
- Dostępne tylko w sesjach zdalnych (claude.ai) na oficjalnym API (first-party).
- Wyszukiwanie niczego nie instaluje — to czyste odkrywanie.
