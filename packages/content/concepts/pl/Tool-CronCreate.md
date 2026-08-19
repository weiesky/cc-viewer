# CronCreate

Planuje prompt do umieszczenia w kolejce w przyszłym momencie — jednorazowo lub cyklicznie. Używa standardowej składni cron z 5 polami w lokalnej strefie czasowej użytkownika, bez konieczności konwersji strefy czasowej.

## Kiedy używać

- **Jednorazowe przypomnienia**: Gdy użytkownik chce otrzymać przypomnienie o określonej godzinie ("przypomnij mi jutro o 15:00"). Ustawienie `recurring: false` powoduje automatyczne usunięcie zadania po uruchomieniu.
- **Cykliczne harmonogramy**: Gdy coś ma być wykonywane wielokrotnie ("każdy dzień roboczy o 9:00", "co 30 minut"). Domyślna wartość `recurring: true` obsługuje ten przypadek.
- **Pętle autonomicznego agenta**: Do tworzenia przepływów pracy, które same się wyzwalają według harmonogramu — np. codzienne podsumowania lub okresowe sprawdzanie stanu.
- **Trwałe zadania**: Gdy harmonogram musi przetrwać restart sesji. Podanie `durable: true` zapisuje zadanie w `.claude/scheduled_tasks.json`.
- **Przybliżone godziny**: Gdy użytkownik mówi "około 9:00" lub "co godzinę", należy wybrać przesuniętą wartość minuty (np. `57 8 * * *` lub `7 * * * *`), aby uniknąć skupiania wielu użytkowników na :00 lub :30.

## Parametry

- `cron` (string, wymagany): Wyrażenie cron z 5 polami w lokalnej strefie czasowej użytkownika. Format: `minuta godzina dzień-miesiąca miesiąc dzień-tygodnia`. Przykład: `"0 9 * * 1-5"` oznacza poniedziałek–piątek o 9:00.
- `prompt` (string, wymagany): Tekst promptu do umieszczenia w kolejce po wyzwoleniu crona — dokładna wiadomość, która zostanie wysłana do REPL w zaplanowanym czasie.
- `recurring` (boolean, opcjonalny, domyślnie `true`): Przy `true` zadanie uruchamia się w każdym pasującym interwale cron i automatycznie wygasa po 7 dniach. Przy `false` zadanie uruchamia się dokładnie raz, a następnie jest usuwane — do jednorazowych przypomnień.
- `durable` (boolean, opcjonalny, domyślnie `false`): Przy `false` harmonogram istnieje tylko w pamięci i ginie wraz z zakończeniem sesji. Przy `true` zadanie jest utrwalane w `.claude/scheduled_tasks.json` i przeżywa restarty.

## Przykłady

### Przykład 1: jednorazowe przypomnienie

Użytkownik mówi: "Przypomnij mi jutro o 14:30, żeby wysłać tygodniowy raport." Zakładając, że jutro jest 21 kwietnia:

```json
{
  "cron": "30 14 21 4 *",
  "prompt": "Przypomnienie: wyślij teraz tygodniowy raport.",
  "recurring": false,
  "durable": true
}
```

`recurring: false` zapewnia, że zadanie usunie się po uruchomieniu. `durable: true` zachowuje je przez ewentualne restarty.

### Przykład 2: cykliczne poranne zadanie w dni robocze

Użytkownik mówi: "Każdego ranka w dni robocze podsumuj moje otwarte zgłoszenia na GitHub."

```json
{
  "cron": "3 9 * * 1-5",
  "prompt": "Podsumuj wszystkie otwarte zgłoszenia GitHub przypisane do mnie.",
  "recurring": true,
  "durable": true
}
```

Minuta `3` zamiast `0` pozwala uniknąć skoku obciążenia na pełną godzinę. Zadanie automatycznie wygasa po 7 dniach.

## Uwagi

- **Automatyczne wygaśnięcie po 7 dniach**: Cykliczne zadania są automatycznie usuwane po maksymalnie 7 dniach. W przypadku dłuższego harmonogramu należy odtworzyć zadanie przed jego wygaśnięciem.
- **Uruchamianie tylko w stanie bezczynności**: `CronCreate` umieszcza prompt w kolejce tylko wtedy, gdy REPL nie przetwarza innego zapytania. Jeśli REPL jest zajęty w momencie wyzwolenia, prompt czeka na zakończenie bieżącego zapytania.
- **Unikaj minut :00 i :30**: W przypadku przybliżonych godzin świadomie wybieraj przesunięte wartości minut, aby rozłożyć obciążenie systemu. Używaj :00/:30 tylko wtedy, gdy użytkownik podaje dokładną minutę.
- **Brak konwersji strefy czasowej**: Wyrażenie cron jest interpretowane bezpośrednio w lokalnej strefie czasowej użytkownika. Konwersja do UTC ani żadnej innej strefy nie jest potrzebna.
