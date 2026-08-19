# Skill

Wywołuje nazwany skill wewnątrz bieżącej rozmowy. Skille to wstępnie spakowane pakiety możliwości — wiedza dziedzinowa, przepływy pracy, a czasem dostęp do narzędzi — które środowisko udostępnia asystentowi poprzez przypomnienia systemowe.

## Kiedy używać

- Użytkownik wpisuje komendę ukośnikową, taką jak `/review` czy `/init` — komendy ukośnikowe to skille i muszą być wykonywane przez to narzędzie.
- Użytkownik opisuje zadanie, które pasuje do warunków wyzwalających reklamowanego skilla (na przykład prośba o skanowanie transkryptów w celu wykrycia powtarzających się monitów o uprawnienia pasuje do `fewer-permission-prompts`).
- Zadeklarowany cel skilla jest bezpośrednim dopasowaniem do bieżącego pliku, żądania lub kontekstu rozmowy.
- Wyspecjalizowane, powtarzalne przepływy pracy są dostępne jako skille i kanoniczna procedura jest preferowana nad ad-hoc.
- Użytkownik pyta "jakie skille są dostępne" — wylistuj reklamowane nazwy i wywołuj tylko po potwierdzeniu.

## Parametry

- `skill` (string, wymagany): Dokładna nazwa skilla wylistowana w bieżącym przypomnieniu systemowym dostępnych skilli. Dla skilli z przestrzenią nazw wtyczki użyj w pełni kwalifikowanej formy `plugin:skill` (na przykład `skill-creator:skill-creator`). Nie dodawaj początkowego ukośnika.
- `args` (string, opcjonalny): Argumenty w dowolnym formacie przekazywane do skilla. Format i semantyka są zdefiniowane przez własną dokumentację każdego skilla.

## Przykłady

### Przykład 1: Uruchom skill review na bieżącej gałęzi

```
Skill(skill="review")
```

Skill `review` pakuje kroki do przeglądu pull requesta względem bieżącej gałęzi bazowej. Wywołanie go ładuje procedurę przeglądu zdefiniowaną przez środowisko do tury.

### Przykład 2: Wywołanie skilla z przestrzeni nazw wtyczki z argumentami

```
Skill(
  skill="skill-creator:skill-creator",
  args="create a skill that summarizes git log for a given date range"
)
```

Kieruje żądanie przez punkt wejścia wtyczki `skill-creator`, aby uruchomił się przepływ pracy autorski.

## Uwagi

- Wywołuj tylko skille, których nazwy pojawiają się dosłownie w przypomnieniu systemowym dostępnych skilli, lub skille, które użytkownik wpisał bezpośrednio jako `/nazwa` w swojej wiadomości. Nigdy nie zgaduj ani nie wymyślaj nazw skilli z pamięci lub danych treningowych — jeśli skill nie jest reklamowany, nie wywołuj tego narzędzia.
- Gdy żądanie użytkownika pasuje do reklamowanego skilla, wywołanie `Skill` jest blokującym warunkiem wstępnym: wywołaj je przed wygenerowaniem jakiejkolwiek innej odpowiedzi dotyczącej zadania. Nie opisuj, co skill zrobiłby — uruchom go.
- Nigdy nie wymieniaj skilla z nazwy bez faktycznego wywołania go. Zapowiadanie skilla bez wywołania narzędzia jest mylące.
- Nie używaj `Skill` dla wbudowanych komend CLI, takich jak `/help`, `/clear`, `/model` czy `/exit`. Są one obsługiwane bezpośrednio przez środowisko.
- Nie wywołuj ponownie skilla, który już działa w bieżącej turze. Jeśli widzisz znacznik `<command-name>` w bieżącej turze, skill został już załadowany — postępuj zgodnie z jego instrukcjami, zamiast wywoływać narzędzie ponownie.
- Jeśli kilka skilli mogłoby pasować, wybierz najbardziej specyficzny. Dla zmian konfiguracyjnych, takich jak dodawanie uprawnień lub hooków, preferuj `update-config` nad ogólne podejście do ustawień.
- Wykonanie skilla może wprowadzić nowe przypomnienia systemowe, narzędzia lub ograniczenia na resztę tury. Przeczytaj ponownie stan rozmowy po zakończeniu skilla, zanim kontynuujesz.
