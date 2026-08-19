# Body Diff JSON (przyrostowe porównanie treści żądania)

## Kontekst

MainAgent w Claude Code stosuje mechanizm wysyłania pełnego kontekstu — każde żądanie zawiera kompletną historię rozmowy, system prompt, definicje narzędzi itp. Oznacza to, że w miarę postępu rozmowy treść żądania staje się coraz większa, a bezpośrednie przeglądanie surowego Body utrudnia szybkie zlokalizowanie „co dokładnie zostało dodane w tej turze".

Body Diff JSON rozwiązuje właśnie ten problem: automatycznie porównuje treści dwóch kolejnych żądań MainAgent, wyodrębnia przyrostowe zmiany i pozwala od razu zobaczyć, co faktycznie zostało dodane w bieżącym żądaniu.

## Zasada działania

1. **Identyfikacja kolejnych żądań MainAgent**: bieżące żądanie musi być typu MainAgent i musi istnieć poprzednie żądanie MainAgent
2. **Porównanie pole po polu**: iteracja po wszystkich polach najwyższego poziomu w treści żądania, z pominięciem wewnętrznych właściwości z prefiksem `_`
3. **Inteligentne wyodrębnianie różnic**:
   - Nowe pola: wyświetlane bezpośrednio
   - Usunięte pola: nie są wyświetlane (zazwyczaj nie wpływają na zrozumienie)
   - Zmienione pola: wyświetlana jest bieżąca wartość
   - Tablica `messages` — specjalne traktowanie: wyświetlane są tylko nowe wiadomości (ponieważ w normalnej rozmowie wiadomości są dopisywane, a prefiks pozostaje bez zmian)
4. **Wykrywanie zmniejszenia treści żądania**: jeśli bieżące żądanie jest mniejsze od poprzedniego, oznacza to obcięcie kontekstu lub reset sesji — w takim przypadku wyświetlany jest komunikat informacyjny zamiast diff

## Typowe scenariusze

W normalnej turze rozmowy Body Diff JSON zazwyczaj zawiera tylko:
- `messages`: 1–2 nowe wiadomości (dane wejściowe użytkownika + odpowiedź asystenta z poprzedniej tury)

Jeśli w diff pojawiają się zmiany pól `system`, `tools`, `model` itp., oznacza to zmianę konfiguracji w bieżącej turze, co często jest również przyczyną przebudowy cache.

## Sposób użycia

- Body Diff JSON jest wyświetlany w panelu szczegółów żądania MainAgent
- Kliknięcie nagłówka rozwija/zwija zawartość
- Obsługuje tryby podglądu JSON i Text oraz kopiowanie jednym kliknięciem
- W lewym górnym rogu **CC-Viewer → Ustawienia globalne** można ustawić „Domyślnie rozwiń Body Diff JSON"
