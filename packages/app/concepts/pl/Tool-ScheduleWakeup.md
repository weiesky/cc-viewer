# ScheduleWakeup

Planuje moment wznowienia pracy w trybie dynamicznym `/loop`. Narzędzie pozwala Claude na samodzielne zarządzanie tempem iteracji zadania poprzez uśpienie na wybrany interwał, a następnie ponowne uruchomienie z tym samym promptem pętli.

## Kiedy używać

- Przy samodzielnym zarządzaniu tempem dynamicznego zadania `/loop`, gdzie interwał iteracji zależy od stanu pracy, a nie od stałego zegara
- Przy oczekiwaniu na zakończenie długiego budowania, wdrożenia lub testu przed sprawdzeniem wyników
- Przy wstawianiu bezczynnych ticków między iteracjami, gdy nie ma konkretnego sygnału do monitorowania
- Przy uruchamianiu autonomicznej pętli bez promptu użytkownika — przekaż dosłowny sentinel `<<autonomous-loop-dynamic>>` jako `prompt`
- Przy odpytywaniu procesu, którego stan za chwilę się zmieni (użyj krótkiego opóźnienia, aby utrzymać pamięć podręczną ciepłą)

## Aktywacja

- Niedostępne na Amazon Bedrock, Claude Platform on AWS, Google Cloud Agent Platform i Microsoft Foundry.
- Również wyłączone, gdy pobieranie flag funkcji jest wyłączone (zmienne środowiskowe telemetrii/ruchu).

## Parametry

- `delaySeconds` (liczba, wymagane): Sekundy do wznowienia. Środowisko uruchomieniowe automatycznie ogranicza wartość do `[60, 3600]`, więc ręczne ograniczanie nie jest konieczne.
- `reason` (ciąg znaków, wymagane): Jedno krótkie zdanie wyjaśniające wybrane opóźnienie. Wyświetlane użytkownikowi i zapisywane w telemetrii. Bądź konkretny — "sprawdzam długie budowanie bun" jest bardziej przydatne niż "czekam."
- `prompt` (ciąg znaków, wymagane): Wejście `/loop` do uruchomienia po przebudzeniu. Przekazuj ten sam ciąg w każdej turze, aby następne uruchomienie powtórzyło zadanie. W przypadku autonomicznej pętli bez promptu użytkownika przekaż dosłowny sentinel `<<autonomous-loop-dynamic>>`.

## Przykłady

### Przykład 1: krótkie opóźnienie do ponownego sprawdzenia szybko zmieniającego się sygnału (utrzymanie ciepłej pamięci podręcznej)

Budowanie właśnie się rozpoczęło i zazwyczaj kończy się w dwie do trzech minut.

```json
{
  "delaySeconds": 120,
  "reason": "sprawdzam budowanie bun, oczekiwane zakończenie za ~2 min",
  "prompt": "sprawdź status budowania i zgłoś błędy"
}
```

120 sekund utrzymuje kontekst rozmowy w pamięci podręcznej promptów Anthropic (TTL 5 min), więc następne przebudzenie jest szybsze i tańsze.

### Przykład 2: długi bezczynny tick (zaakceptuj chybienie pamięci podręcznej, zamortyzuj na dłuższe oczekiwanie)

Migracja bazy danych jest w toku i zazwyczaj zajmuje 20–40 minut.

```json
{
  "delaySeconds": 1200,
  "reason": "migracja zajmuje zwykle 20–40 min; sprawdzam za 20 min",
  "prompt": "sprawdź status migracji i kontynuuj jeśli zakończona"
}
```

Pamięć podręczna będzie zimna przy przebudzeniu, ale 20-minutowe oczekiwanie z nadwyżką amortyzuje koszt pojedynczego chybienia. Odpytywanie co 5 minut płaciłoby tę samą cenę chybienia 4 razy bez żadnej korzyści.

## Uwagi

- **5-minutowe TTL pamięci podręcznej**: Pamięć podręczna promptów Anthropic wygasa po 300 sekundach. Opóźnienia poniżej 300 s utrzymują kontekst ciepły; opóźnienia powyżej 300 s powodują chybienie pamięci podręcznej przy następnym przebudzeniu.
- **Unikaj dokładnie 300 s**: To najgorsze z obu światów — płacisz za chybienie pamięci podręcznej bez uzyskania znacząco dłuższego oczekiwania. Albo obniż do 270 s (utrzymaj ciepłą pamięć podręczną), albo zobowiąż się do 1200 s lub więcej (jedno chybienie kupuje znacznie dłuższe oczekiwanie).
- **Domyślna wartość dla bezczynnych ticków**: Gdy nie ma konkretnego sygnału do monitorowania, użyj **1200–1800 s** (20–30 min). Pozwala to pętli sprawdzać okresowo bez niepotrzebnego spalania pamięci podręcznej 12 razy na godzinę.
- **Automatyczne ograniczanie**: Środowisko uruchomieniowe ogranicza `delaySeconds` do `[60, 3600]`. Wartości poniżej 60 stają się 60; wartości powyżej 3600 stają się 3600. Nie trzeba samodzielnie obsługiwać tych granic.
- **Pomiń wywołanie, aby zakończyć pętlę**: Jeśli zamierzasz zatrzymać iteracje, nie wywołuj ScheduleWakeup. Samo pominięcie wywołania kończy pętlę.
- **Przekazuj ten sam `prompt` w każdej turze**: Pole `prompt` musi zawierać oryginalną instrukcję `/loop` przy każdym wywołaniu, aby następne przebudzenie wiedziało, które zadanie wznowić.
