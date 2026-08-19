# NotebookEdit

Modyfikuje pojedynczą komórkę w notatniku Jupyter (`.ipynb`). Obsługuje zastąpienie źródła komórki, wstawienie nowej komórki lub usunięcie istniejącej komórki, zachowując resztę struktury notatnika.

## Kiedy używać

- Naprawianie lub aktualizowanie komórki kodu w notatniku analitycznym bez przepisywania całego pliku
- Zamiana komórki markdown w celu poprawy narracji lub dodania dokumentacji
- Wstawianie nowej komórki kodu lub markdown na znanej pozycji w istniejącym notatniku
- Usuwanie przestarzałej lub zepsutej komórki, aby kolejne komórki już od niej nie zależały
- Przygotowywanie reprodukowalnego notatnika poprzez iterowanie po komórkach jedna po drugiej

## Parametry

- `notebook_path` (string, wymagany): Bezwzględna ścieżka do pliku `.ipynb`. Ścieżki względne są odrzucane.
- `new_source` (string, wymagany): Nowe źródło komórki. Dla `replace` i `insert` staje się treścią komórki; dla `delete` jest ignorowane, ale wciąż wymagane przez schemat.
- `cell_id` (string, opcjonalny): ID docelowej komórki. W trybach `replace` i `delete` narzędzie działa na tej komórce. W trybie `insert` nowa komórka jest wstawiana bezpośrednio po komórce z tym ID; pomiń, aby wstawić na początku notatnika.
- `cell_type` (enum, opcjonalny): Albo `code`, albo `markdown`. Wymagane, gdy `edit_mode` to `insert`. Pominięte podczas `replace` zachowuje typ istniejącej komórki.
- `edit_mode` (enum, opcjonalny): `replace` (domyślny), `insert` lub `delete`.

## Przykłady

### Przykład 1: Zastąp błędną komórkę kodu
Wywołaj `NotebookEdit` z `notebook_path` ustawionym na ścieżkę bezwzględną, `cell_id` ustawionym na ID docelowej komórki oraz `new_source` zawierającym poprawiony kod Pythona. Pozostaw `edit_mode` na domyślnej wartości `replace`.

### Przykład 2: Wstaw wyjaśnienie markdown
Aby dodać komórkę markdown zaraz za istniejącą komórką `setup`, ustaw `edit_mode: "insert"`, `cell_type: "markdown"`, `cell_id` na ID komórki setup, a narrację umieść w `new_source`.

### Przykład 3: Usuń nieaktualną komórkę
Ustaw `edit_mode: "delete"` i podaj `cell_id` komórki do usunięcia. Podaj dowolny ciąg dla `new_source`; nie jest stosowany.

## Uwagi

- Zawsze przekazuj ścieżkę bezwzględną. `NotebookEdit` nie rozwiązuje ścieżek względnych względem katalogu roboczego.
- Narzędzie przepisuje tylko docelową komórkę; liczniki wykonań, wyjścia i metadane niepowiązanych komórek pozostają nietknięte.
- Wstawianie bez `cell_id` umieszcza nową komórkę na samym początku notatnika.
- `cell_type` jest obowiązkowy dla wstawień. Dla zamian pomiń, chyba że wyraźnie chcesz skonwertować komórkę kodu na markdown lub odwrotnie.
- Aby sprawdzić komórki i pobrać ich identyfikatory, najpierw użyj narzędzia `Read` na notatniku; zwraca komórki wraz z ich zawartością i wyjściami.
- Do zwykłych plików źródłowych używaj zwykłego `Edit`; `NotebookEdit` jest specyficzne dla JSON `.ipynb` i rozumie jego strukturę komórek.
