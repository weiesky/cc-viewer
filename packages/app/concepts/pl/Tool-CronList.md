# CronList

Wyswietla wszystkie zadania cron zaplanowane za pomoca `CronCreate` w biezacej sesji. Zwraca podsumowanie kazdego aktywnego crona, zawierajace `id`, wyrazenie cron, skrocony `prompt`, flage `recurring`, flage `durable` oraz nastepny czas uruchomienia.

## Kiedy uzywac

- Aby przejrzec wszystkie aktualnie zaplanowane zadania przed wprowadzeniem zmian lub zakonczeniem sesji.
- Aby znalezc prawidlowe `id` zadania przed wywolaniem `CronDelete` w celu jego usuniecia.
- Aby zdiagnozowac, dlaczego oczekiwane zadanie nigdy nie zostalo uruchomione, potwierdzajac jego istnienie i sprawdzajac nastepny czas uruchomienia.
- Aby potwierdzic, ze jednorazowe (niepowtarzalne) zadanie jeszcze nie zostalo uruchomione i nadal oczekuje na wykonanie.

## Parametry

Brak.

## Przyklady

### Przyklad 1: przeglad wszystkich zaplanowanych zadan

Wywolaj `CronList` bez argumentow, aby pobrac pelna liste wszystkich aktywnych zadan cron. Odpowiedz zawiera dla kazdego zadania jego `id`, wyrazenie cron definiujace harmonogram, skrocona wersje `prompt`, ktory zostanie wykonany, czy jest `recurring` (powtarzalne), czy jest `durable` (trwale miedzy restartami) oraz nastepny zaplanowany czas uruchomienia.

### Przyklad 2: znajdz id konkretnego powtarzajacego sie zadania

Jesli utworzono wiele zadan cron i trzeba usunac jedno konkretne powtarzajace sie zadanie, najpierw wywolaj `CronList`. Przeszukaj zwrocona liste, aby znalezc zadanie, ktorego podsumowanie `prompt` i wyrazenie cron odpowiadaja zadaniu do usuniecia. Skopiuj jego `id` i przekaz do `CronDelete`.

## Uwagi

- Listowane sa tylko zadania utworzone w biezacej sesji, chyba ze zostaly utworzone z `durable: true`, co pozwala im przetrwac restarty sesji.
- Pole `prompt` w podsumowaniu jest skrocone; pokazuje tylko poczatek pelnego tekstu promptu, a nie cala jego tresc.
- Jednorazowe zadania (`recurring` wynosi `false`), ktore zostaly juz uruchomione, sa automatycznie usuwane i nie pojawiaja sie juz na liscie.
