# TodoWrite

Zapisuje strukturalną listę todo dla bieżącej sesji, zastępując poprzednią listę. Każdy element zawiera swój tekst, status oraz formę czasu teraźniejszego ciągłego wyświetlaną we wskaźnikach postępu.

## Kiedy używać

- Zadanie składa się z kilku wyraźnych kroków, a ich śledzenie pomaga Tobie (i użytkownikowi) widzieć postęp.
- Użytkownik wprost prosi o listę todo.
- Chcesz oznaczyć dokładnie jeden element jako w toku, podczas gdy reszta pozostaje oczekująca lub ukończona.

## Parametry

- `todos` (tablica, wymagany): Kompletna zaktualizowana lista todo. Każdy wpis zawiera:
  - `content` (string): Opis zadania.
  - `status` (string): Jedna z wartości `pending`, `in_progress`, `completed`.
  - `activeForm` (string): Tekst w czasie teraźniejszym ciągłym wyświetlany, gdy element jest w toku (np. "Running tests").

## Przykłady

### Przykład 1: Śledzenie trzyetapowej zmiany

```
TodoWrite(
  todos=[
    {content="Update the parser", status="in_progress", activeForm="Updating the parser"},
    {content="Add unit tests", status="pending", activeForm="Adding unit tests"},
    {content="Run the full test suite", status="pending", activeForm="Running the full test suite"}
  ]
)
```

Cała lista jest przepisywana przy każdym wywołaniu — zawsze uwzględniaj wszystkie elementy, nie tylko te, które się zmieniły.

## Uwagi

- Lista jest zastępowana w całości przy każdym wywołaniu; aby zaktualizować jeden element, prześlij ponownie wszystkie elementy z nowym statusem.
- Utrzymuj dokładnie jeden element w statusie `in_progress` w danym momencie.
- W sesjach, w których włączone są narzędzia zadań strukturalnych (`TaskCreate`/`TaskUpdate`/`TaskList`), środowisko może zaoferować je zamiast `TodoWrite` — preferuj ten zestaw narzędzi, który jest reklamowany.
