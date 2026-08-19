# Monitor

Uruchamia monitor działający w tle, który strumieniuje zdarzenia z długo działającego skryptu. Każda linia standardowego wyjścia staje się powiadomieniem — kontynuuj pracę, a zdarzenia będą pojawiać się w czacie.

## Kiedy używać

- Śledzenie błędów, ostrzeżeń lub sygnatur awarii w pliku dziennika podczas trwającego wdrożenia
- Odpytywanie zdalnego API, PR lub potoku CI co 30 sekund w poszukiwaniu nowych zdarzeń stanu
- Obserwowanie zmian w katalogu systemu plików lub w danych wyjściowych kompilacji w czasie rzeczywistym
- Oczekiwanie na określony warunek przez wiele iteracji (np. kamień milowy kroku treningowego lub opróżnienie kolejki)
- **Nie** do prostego "czekaj aż skończy" — do tego użyj `Bash` z `run_in_background`; wyśle jedno powiadomienie o zakończeniu, gdy proces się zakończy

## Aktywacja

- Domyślnie wyłączony (flaga funkcji po stronie serwera).
- Niedostępny na Amazon Bedrock, Google Cloud i Microsoft Foundry.
- Wyłączony, gdy ustawione jest `DISABLE_TELEMETRY` lub `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`.
- Źródło WebSocket wymaga Claude Code 2.1.195+.

## Parametry

- `command` (ciąg znaków, wymagany): Polecenie powłoki lub skrypt do uruchomienia. Każda linia zapisana na standardowym wyjściu staje się oddzielnym zdarzeniem powiadomienia. Monitor kończy działanie, gdy proces się zakończy.
- `description` (ciąg znaków, wymagany): Krótka, czytelna etykieta wyświetlana w każdym powiadomieniu. Być konkretnym — "błędy w deploy.log" jest lepsze niż "obserwowanie logów". Ta etykieta identyfikuje, który monitor się uruchomił.
- `timeout_ms` (liczba, domyślnie `300000`, maks `3600000`): Termin wymuszonego zakończenia w milisekundach. Po tym czasie proces zostaje zakończony. Ignorowane gdy `persistent: true`.
- `persistent` (wartość logiczna, domyślnie `false`): Gdy `true`, monitor działa przez cały czas trwania sesji bez limitu czasu. Zatrzymaj go jawnie za pomocą `TaskStop`.

## Przykłady

### Przykład 1: Śledzenie pliku dziennika pod kątem błędów i awarii

Ten przykład obejmuje wszystkie stany końcowe: znacznik sukcesu, traceback, typowe słowa kluczowe błędów, zakończenie OOM i nieoczekiwane wyjście procesu.

```bash
tail -F /var/log/deploy.log | grep -E --line-buffered \
  "deployed|Traceback|Error|FAILED|assert|Killed|OOM"
```

Używaj `grep --line-buffered` w każdym potoku. Bez tego system operacyjny buforuje dane wyjściowe w blokach 4 KB i zdarzenia mogą być opóźnione o minuty. Wzorzec naprzemienności obejmuje zarówno ścieżkę sukcesu (`deployed`), jak i ścieżki awarii (`Traceback`, `Error`, `FAILED`, `Killed`, `OOM`). Monitor obserwujący tylko znacznik sukcesu milczy podczas awarii — cisza wygląda identycznie jak "nadal działa".

### Przykład 2: Odpytywanie zdalnego API co 30 sekund

```bash
while true; do
  curl -sf "https://api.example.com/status" || true
  sleep 30
done | grep --line-buffered -E "completed|failed|error"
```

`|| true` zapobiega zakończeniu pętli przez przejściowy błąd sieciowy. Interwały odpytywania wynoszące 30 sekund lub więcej są odpowiednie dla zdalnych API, aby uniknąć limitów częstotliwości. Dostosuj wzorzec grep, aby przechwytywać zarówno odpowiedzi sukcesu, jak i błędów, aby błędy po stronie API nie były maskowane ciszą.

## Uwagi

- **Zawsze używaj `grep --line-buffered` w potokach.** Bez tego buforowanie potoku opóźnia zdarzenia o minuty, ponieważ system operacyjny gromadzi dane wyjściowe aż do wypełnienia bloku 4 KB. `--line-buffered` wymusza opróżnienie po każdej linii.
- **Filtr musi obejmować zarówno sygnatury sukcesu, jak i awarii.** Monitor obserwujący tylko znacznik sukcesu milczy podczas awarii, zawieszenia lub nieoczekiwanego wyjścia. Rozszerz naprzemienność: uwzględnij `Error`, `Traceback`, `FAILED`, `Killed`, `OOM` i podobne znaczniki stanu końcowego obok słowa kluczowego sukcesu.
- **Interwały odpytywania: 30 sekund lub więcej dla zdalnych API.** Częste odpytywanie zewnętrznych usług grozi błędami limitów częstotliwości lub zablokowaniem. Dla lokalnych sprawdzeń systemu plików lub procesów odpowiednie jest 0,5–1 sekunda.
- **Używaj `persistent: true` do monitorów przez cały czas trwania sesji.** Domyślny `timeout_ms` wynoszący 300 000 ms (5 minut) kończy proces. Dla monitorów, które mają działać do jawnego zatrzymania, ustaw `persistent: true` i wywołaj `TaskStop` po zakończeniu.
- **Automatyczne zatrzymanie przy zalewaniu zdarzeniami.** Każda linia standardowego wyjścia to wiadomość w rozmowie. Jeśli filtr jest zbyt szeroki i generuje zbyt wiele zdarzeń, monitor zostaje automatycznie zatrzymany. Uruchom ponownie z ciaśniejszym wzorcem `grep`. Linie przychodzące w ciągu 200 ms są łączone w jedno powiadomienie.
