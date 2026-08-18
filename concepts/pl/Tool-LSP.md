# LSP

Odpytuje serwery Language Server Protocol (LSP) o inteligencję kodu — definicje, referencje, podpowiedzi (hover), symbole, implementacje i hierarchię wywołań. Bardziej precyzyjne niż wyszukiwanie tekstowe, ponieważ rozumie kod semantycznie.

## Kiedy używać

- Przejść do definicji symbolu (`goToDefinition`) lub znaleźć każdą referencję (`findReferences`)
- Odczytać sygnatury typów / dokumentację symbolu (`hover`)
- Wylistować symbole w jednym pliku (`documentSymbol`) lub wyszukać je w całym projekcie (`workspaceSymbol`)
- Znaleźć implementacje interfejsu lub metody abstrakcyjnej (`goToImplementation`)
- Przejść hierarchię wywołań funkcji (`prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`)

## Aktywacja

- Nieaktywne, dopóki nie zostanie zainstalowana wtyczka inteligencji kodu dla danego języka (binarny plik serwera jest instalowany osobno).
- Narzędzie pojawia się tylko wtedy, gdy podłączony jest klient LSP.

## Parametry

- `operation` (string, wymagany): jedna z operacji wymienionych powyżej.
- `filePath` (string, wymagany): plik, na którym wykonać operację.
- `line` (liczba, wymagany): numer wiersza liczony od 1, tak jak pokazano w edytorze.
- `character` (liczba, wymagany): przesunięcie znaku liczone od 1, tak jak pokazano w edytorze.

## Uwagi

- Wymaga skonfigurowanego serwera LSP dla danego typu pliku; w przeciwnym razie wywołanie zwraca błąd.
- Wiersz i znak są liczone od 1 (współrzędne edytora), a nie od 0.
- Preferuj LSP zamiast `Grep`, gdy potrzebujesz nawigacji semantycznej (prawdziwa definicja/referencja), a nie dopasowania tekstowego.

## Powiązane pojęcia

- Uzupełnia `Read` i `Edit` podczas nawigacji po kodzie i jego zmieniania.
