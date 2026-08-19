# Write

Tworzy nowy plik lub całkowicie zastępuje zawartość istniejącego w lokalnym systemie plików. Ponieważ zastępuje wszystko w ścieżce docelowej, powinno być zarezerwowane dla prawdziwego tworzenia lub celowych pełnych przepisań.

## Kiedy używać

- Tworzenie całkowicie nowego pliku źródłowego, testu lub konfiguracji, który jeszcze nie istnieje
- Generowanie świeżej fixtury, snapshotu lub pliku danych od zera
- Wykonywanie pełnego przepisania, gdy przyrostowy `Edit` byłby bardziej skomplikowany niż zaczęcie od nowa
- Emitowanie żądanego artefaktu, takiego jak schemat, migracja lub skrypt kompilacji, który użytkownik wyraźnie poprosił o wyprodukowanie

## Parametry

- `file_path` (string, wymagany): Bezwzględna ścieżka pliku do zapisu. Wszystkie katalogi nadrzędne muszą już istnieć.
- `content` (string, wymagany): Pełny tekst do zapisania w pliku. Staje się całą treścią pliku.

## Przykłady

### Przykład 1: Utwórz nowy moduł pomocniczy
Wywołaj `Write` z `file_path: "/Users/me/app/src/utils/slugify.ts"` i podaj implementację jako `content`. Używaj tego tylko po zweryfikowaniu, że plik jeszcze nie istnieje.

### Przykład 2: Ponownie wygeneruj pochodny artefakt
Po zmianie źródła schematu przepisz `/Users/me/app/generated/schema.json` w jednym wywołaniu `Write`, używając świeżo wygenerowanego JSON-a jako `content`.

### Przykład 3: Zastąp mały plik fixtury
Dla jednorazowej fixtury testowej, gdzie zmienia się każdy wiersz, `Write` może być jaśniejszy niż sekwencja wywołań `Edit`. Najpierw odczytaj plik, potwierdź zakres, a następnie nadpisz.

## Uwagi

- Przed nadpisaniem istniejącego pliku musisz wywołać `Read` na nim w bieżącej sesji. `Write` odmawia nadpisania niewidzianej zawartości.
- Preferuj `Edit` dla każdej zmiany, która dotyka tylko części pliku. `Edit` wysyła tylko diff, co jest szybsze, bezpieczniejsze i łatwiejsze do przeglądu.
- Nie twórz proaktywnie dokumentacji Markdown, plików `README.md` ani plików changelog, chyba że użytkownik wyraźnie o to poprosi.
- Nie dodawaj emoji, tekstów marketingowych ani dekoracyjnych banerów, chyba że użytkownik prosi o taki styl.
- Najpierw zweryfikuj, czy katalog nadrzędny istnieje, wywołaniem `ls` przez `Bash`; `Write` nie tworzy pośrednich folderów.
- Dostarczaj zawartość dokładnie tak, jak chcesz, aby została utrwalona; nie ma szablonów ani przetwarzania końcowego.
