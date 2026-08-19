# Glob

Dopasowuje nazwy plików do wzorca glob i zwraca ścieżki posortowane od najnowszego czasu modyfikacji. Zoptymalizowane pod szybkie lokalizowanie plików w bazach kodu dowolnej wielkości bez wywoływania `find`.

## Kiedy używać

- Wyliczanie wszystkich plików określonego rozszerzenia (na przykład wszystkich plików `*.ts` pod `src`)
- Odkrywanie plików konfiguracyjnych lub fixtur po konwencji nazewnictwa (`**/jest.config.*`, `**/*.test.tsx`)
- Zawężanie powierzchni wyszukiwania przed uruchomieniem ukierunkowanego `Grep`
- Sprawdzanie, czy plik już istnieje pod znanym wzorcem, przed wywołaniem `Write`
- Znajdowanie ostatnio zmodyfikowanych plików, opierając się na sortowaniu po czasie modyfikacji

## Parametry

- `pattern` (string, wymagany): Wyrażenie glob do dopasowania. Obsługuje `*` dla wieloznaczników w pojedynczym segmencie, `**` dla dopasowań rekurencyjnych oraz `{a,b}` dla alternatyw, na przykład `src/**/*.{ts,tsx}`.
- `path` (string, opcjonalny): Katalog, w którym uruchomić wyszukiwanie. Gdy podany, musi być poprawną ścieżką katalogu. Pomiń pole całkowicie, aby przeszukać bieżący katalog roboczy. Nie przekazuj ciągów `"undefined"` ani `"null"`.

## Przykłady

### Przykład 1: Każdy plik źródłowy TypeScript
Wywołaj `Glob` z `pattern: "src/**/*.ts"`. Wynik to lista posortowana po mtime, więc ostatnio edytowane pliki pojawiają się jako pierwsze, co jest przydatne przy koncentrowaniu się na punktach zapalnych.

### Przykład 2: Zlokalizuj kandydata na definicję klasy
Gdy podejrzewasz, że klasa znajduje się w pliku, którego nazwy nie znasz, przeszukaj z `pattern: "**/*UserService*"`, aby zawęzić kandydatów, a następnie kontynuuj z `Read` lub `Grep`.

### Przykład 3: Równoległe odkrywanie przed większym zadaniem
W jednej wiadomości wywołaj wiele wywołań `Glob` (na przykład jedno dla `**/*.test.ts` i jedno dla `**/fixtures/**`), aby oba działały równolegle, a ich wyniki można było powiązać.

## Uwagi

- Wyniki są uporządkowane po czasie modyfikacji pliku (od najnowszego), a nie alfabetycznie. Sortuj dalej, jeśli potrzebujesz stabilnego porządku.
- Wzorce są oceniane przez narzędzie, a nie przez powłokę; nie musisz ich cytować ani ekranować tak, jak robiłbyś to w wierszu poleceń.
- Dla otwartej eksploracji wymagającej wielu rund wyszukiwania i rozumowania, deleguj do `Agent` z typem agenta Explore, zamiast łączyć wiele wywołań `Glob`.
- Preferuj `Glob` nad wywołaniami `Bash` z `find` lub `ls` do odkrywania nazw plików; obsługuje uprawnienia spójnie i zwraca ustrukturyzowane wyjście.
- Gdy szukasz zawartości wewnątrz plików, a nie nazw plików, użyj `Grep`.
