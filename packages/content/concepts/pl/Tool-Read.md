# Read

Wczytuje zawartość pojedynczego pliku z lokalnego systemu plików. Obsługuje zwykły tekst, kod źródłowy, obrazy, pliki PDF i notatniki Jupyter, zwracając wyniki z numerami wierszy liczonymi od 1 w stylu `cat -n`.

## Kiedy używać

- Odczytywanie pliku źródłowego o znanej ścieżce przed edycją lub analizą
- Inspekcja plików konfiguracyjnych, lockfile, logów lub wygenerowanych artefaktów
- Wyświetlanie zrzutów ekranu lub diagramów, które użytkownik wkleił do rozmowy
- Wyciąganie konkretnego zakresu stron z długiego podręcznika PDF
- Otwieranie notatnika `.ipynb`, aby przejrzeć komórki kodu, markdown i wyjścia komórek razem

## Parametry

- `file_path` (string, wymagany): Bezwzględna ścieżka do pliku docelowego. Ścieżki względne są odrzucane.
- `offset` (liczba całkowita, opcjonalny): Numer wiersza (liczony od 1), od którego zacząć odczyt. Przydatne dla dużych plików w połączeniu z `limit`.
- `limit` (liczba całkowita, opcjonalny): Maksymalna liczba wierszy do zwrócenia, zaczynając od `offset`. Domyślnie 2000 wierszy od góry pliku, gdy pominięty.
- `pages` (string, opcjonalny): Zakres stron dla plików PDF, na przykład `"1-5"`, `"3"` lub `"10-20"`. Wymagany dla plików PDF dłuższych niż 10 stron; maksymalnie 20 stron na żądanie.

## Przykłady

### Przykład 1: Odczytaj cały mały plik
Wywołaj `Read` z ustawionym tylko `file_path` na `/Users/me/project/src/index.ts`. Zwracanych jest do 2000 wierszy z numerami wierszy, co zwykle wystarcza jako kontekst edycji.

### Przykład 2: Stronicowanie długiego logu
Użyj `offset: 5001` i `limit: 500` na pliku logu o kilku tysiącach wierszy, aby pobrać wąskie okno bez marnowania tokenów kontekstu.

### Przykład 3: Wyciągnij konkretne strony PDF
Dla 120-stronicowego PDF-a w `/tmp/spec.pdf` ustaw `pages: "8-15"`, aby wyciągnąć tylko rozdział, którego potrzebujesz. Pominięcie `pages` na dużym PDF-ie powoduje błąd.

### Przykład 4: Wyświetl obraz
Przekaż ścieżkę bezwzględną zrzutu ekranu PNG lub JPG. Obraz jest renderowany wizualnie, dzięki czemu Claude Code może bezpośrednio o nim rozumować.

## Uwagi

- Zawsze preferuj ścieżki bezwzględne. Jeśli użytkownik je podaje, zaufaj im takim, jakimi są.
- Wiersze dłuższe niż 2000 znaków są obcinane; traktuj zwróconą zawartość jako potencjalnie przyciętą dla bardzo szerokich danych.
- Czytasz wiele niezależnych plików? Wywołaj kilka `Read` w tej samej odpowiedzi, aby działały równolegle.
- `Read` nie może wylistować katalogów. Użyj wywołania `ls` przez `Bash` lub narzędzia `Glob`.
- Odczyt istniejącego, ale pustego pliku zwraca przypomnienie systemowe zamiast bajtów pliku, więc obsłuż ten sygnał jawnie.
- Pomyślny `Read` jest wymagany, zanim będziesz mógł użyć `Edit` na tym samym pliku w bieżącej sesji.
