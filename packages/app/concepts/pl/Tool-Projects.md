# Projects

Zarządza dokumentami projektu w bazie wiedzy projektu Claude użytkownika: odczyt, wyszukiwanie, zapis i usuwanie dokumentów lub pobieranie informacji o projekcie.

## Kiedy używać

- Utrwalenie dokumentu (rezultatu, notatek, materiałów referencyjnych) w projekcie użytkownika, aby przetrwał sesję.
- Odczyt lub wyszukanie istniejących dokumentów projektu, aby osadzić bieżące zadanie we wcześniejszym kontekście.
- Przesłanie lokalnego pliku do projektu bez ładowania jego zawartości do kontekstu.
- Usunięcie nieaktualnego dokumentu projektu.

## Parametry

- `method` (string, wymagany): Jedna z wartości `project_info`, `project_read`, `project_search`, `project_write`, `project_delete`.
- `path` (string, opcjonalny): Dla `project_read`/`project_write`/`project_delete`: ścieżka dokumentu. Dla `project_write`: istniejąca ścieżka jest zastępowana w miejscu; nowa czysta nazwa pliku (bez "/") trafia do przestrzeni nazw `claude/<name>`.
- `content` (string, opcjonalny): Dla `project_write`: tekst dokumentu inline. Wzajemnie wykluczający się z `local_path`.
- `local_path` (string, opcjonalny): Dla `project_write`: plik wewnątrz katalogu roboczego do przesłania — jego zawartość nigdy nie trafia do Twojego kontekstu. Wzajemnie wykluczający się z `content`.
- `present_to_user` (boolean, opcjonalny): Dla `project_write`: oznacz ten dokument jako rezultat, który użytkownik musi zobaczyć. Domyślnie false; pozostaw nieustawione dla rutynowych zapisów i zapisów masowych.
- `query` (string, opcjonalny): Dla `project_search`: zapytanie do bazy wiedzy.
- `n` (number, opcjonalny): Dla `project_search`: liczba trafień (domyślnie 5).

## Przykłady

### Przykład 1: Zapisanie rezultatu do projektu

```
Projects(
  method="project_write",
  path="claude/migration-plan.md",
  local_path="./migration-plan.md",
  present_to_user=true
)
```

Przesyła lokalny plik bez wciągania jego zawartości do kontekstu i oznacza go jako rezultat dla użytkownika.

### Przykład 2: Przeszukanie bazy wiedzy

```
Projects(method="project_search", query="authentication refresh tokens", n=5)
```

## Uwagi

- `content` służy do tekstu pisanego inline; `local_path` do wszystkiego, co już jest na dysku — nigdy nie mieszaj tych dwóch.
- Używaj `present_to_user=true` oszczędnie: tylko dla jednego dokumentu, o który użytkownik poprosił lub na którym musi działać.
