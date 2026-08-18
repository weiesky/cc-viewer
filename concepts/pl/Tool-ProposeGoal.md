# ProposeGoal

Proponuje weryfikowalny cel ukończenia sesji. Cel jest pokazywany użytkownikowi w dialogu zatwierdzenia (domyślnie) i, gdy już zostanie ustawiony, kieruje resztę rozmowy ku sprawdzalnemu wynikowi.

## Kiedy używać

- Sesja ma konkretny stan końcowy, który ewaluator mógłby zweryfikować na podstawie rozmowy (np. "all tests in test/auth pass").
- Chcesz uzyskać wyraźną akceptację użytkownika co do tego, co znaczy "gotowe", zanim wykonasz znaczącą pracę.
- Słowa użytkownika same już określiły wynik, a Ty chcesz zapisać go jako cel sesji.

## Parametry

- `condition` (string, wymagany): Warunek ukończenia, sformułowany tak, aby osobny ewaluator mógł zweryfikować go na podstawie rozmowy (np. "all tests in test/auth pass (bun test exits 0)"). Maksymalnie 500 znaków — użytkownik musi móc przeczytać cały warunek w dialogu zatwierdzenia.
- `ask_user` (boolean, opcjonalny): Czy pytać użytkownika o zatwierdzenie, zanim cel zostanie ustawiony. Domyślnie true (pokazywany jest dialog zatwierdzenia). Ustaw false TYLKO wtedy, gdy własne słowa użytkownika w tej rozmowie określiły ten wynik jako to, czego chce; cel jest wtedy ustawiany bezpośrednio z widocznym komunikatem, a użytkownik może go wyczyścić za pomocą `/goal clear`.

## Przykłady

### Przykład 1: Zaproponowanie celu opartego na testach

```
ProposeGoal(condition="npm run test exits 0 with the new catalog cases included")
```

Użytkownik widzi warunek w dialogu zatwierdzenia i może go zaakceptować, edytować lub odrzucić.

### Przykład 2: Bezpośrednie przyjęcie wyniku podanego przez użytkownika

```
ProposeGoal(condition="the login form validates email format and shows an inline error", ask_user=false)
```

Prawidłowe tylko dlatego, że użytkownik wcześniej w rozmowie wprost określił ten wynik.

## Uwagi

- Utrzymuj `condition` krótki i obiektywnie sprawdzalny — niejasne cele ("make it better") mijają się z celem.
- `ask_user=false` jest ściśle ograniczone do wyników, które użytkownik sam określił; wszystko inne musi przejść przez dialog zatwierdzenia.
