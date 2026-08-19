# Edit

Wykonuje dokładne zastąpienie ciągu znaków wewnątrz istniejącego pliku. Jest to preferowany sposób modyfikowania plików, ponieważ przesyłany jest tylko diff, dzięki czemu edycje są precyzyjne i łatwe do audytu.

## Kiedy używać

- Naprawianie błędu w pojedynczej funkcji bez przepisywania otaczającego pliku
- Aktualizowanie wartości konfiguracyjnej, ciągu wersji lub ścieżki importu
- Zmiana nazwy symbolu w całym pliku za pomocą `replace_all`
- Wstawianie bloku w pobliżu kotwicy (rozszerz `old_string`, aby objąć pobliski kontekst, następnie podaj zamiennik)
- Stosowanie małych, dobrze zakreślonych edycji w ramach wieloetapowego refaktoringu

## Parametry

- `file_path` (string, wymagany): Bezwzględna ścieżka pliku do modyfikacji.
- `old_string` (string, wymagany): Dokładny tekst do wyszukania. Musi pasować znak po znaku, włącznie z białymi znakami i wcięciem.
- `new_string` (string, wymagany): Tekst zastępczy. Musi różnić się od `old_string`.
- `replace_all` (boolean, opcjonalny): Gdy `true`, zastępuje każde wystąpienie `old_string`. Domyślnie `false`, co wymaga, aby dopasowanie było unikalne.

## Przykłady

### Przykład 1: Popraw pojedyncze miejsce wywołania
Ustaw `old_string` na dokładną linię `const port = 3000;` i `new_string` na `const port = process.env.PORT ?? 3000;`. Dopasowanie jest unikalne, więc `replace_all` może pozostać przy wartości domyślnej.

### Przykład 2: Zmień nazwę symbolu w całym pliku
Aby zmienić nazwę `getUser` na `fetchUser` wszędzie w `api.ts`, ustaw `old_string: "getUser"`, `new_string: "fetchUser"` oraz `replace_all: true`.

### Przykład 3: Ujednoznacznij powtarzający się fragment
Jeśli `return null;` występuje w kilku gałęziach, rozszerz `old_string` o otaczający kontekst (na przykład poprzedzający wiersz `if`), aby dopasowanie było unikalne. W przeciwnym razie narzędzie zwróci błąd, zamiast zgadywać.

## Uwagi

- Musisz wywołać `Read` dla pliku co najmniej raz w bieżącej sesji, zanim `Edit` zaakceptuje zmiany. Prefiksy z numerami wierszy z wyjścia `Read` nie są częścią zawartości pliku; nie uwzględniaj ich w `old_string` ani `new_string`.
- Białe znaki muszą pasować dokładnie. Zwróć uwagę na tabulatory kontra spacje i końcowe spacje, zwłaszcza w YAML, Makefile i Pythonie.
- Jeśli `old_string` nie jest unikalny, a `replace_all` to `false`, edycja się nie powiedzie. Rozszerz kontekst lub włącz `replace_all`.
- Preferuj `Edit` nad `Write`, gdy plik już istnieje; `Write` nadpisuje cały plik i traci niepowiązaną zawartość, jeśli nie jesteś ostrożny.
- Przy wielu niepowiązanych edycjach w tym samym pliku wykonaj kilka wywołań `Edit` po kolei, zamiast jednego dużego, kruchego zastąpienia.
- Unikaj wprowadzania emoji, tekstów marketingowych lub niezamówionych bloków dokumentacji podczas edycji plików źródłowych.
