# CronDelete

Anuluje zadanie cron wcześniej zaplanowane za pomocą `CronCreate`. Usuwa je natychmiast z magazynu sesji w pamięci. Nie ma żadnego efektu, jeśli zadanie zostało już automatycznie usunięte (zadania jednorazowe są usuwane po uruchomieniu, zadania cykliczne wygasają po 7 dniach).

## Kiedy używać

- Użytkownik prosi o zatrzymanie cyklicznie zaplanowanego zadania przed automatycznym wygaśnięciem po 7 dniach.
- Zadanie jednorazowe nie jest już potrzebne i powinno zostać anulowane przed uruchomieniem.
- Należy zmienić wyrażenie harmonogramu istniejącego zadania — usuń je za pomocą `CronDelete`, a następnie utwórz ponownie za pomocą `CronCreate` z nowym wyrażeniem.
- Czyszczenie wielu nieaktualnych zadań w celu utrzymania porządku w magazynie sesji.

## Parametry

- `id` (string, wymagany): Identyfikator zadania zwrócony przez `CronCreate` podczas pierwszego tworzenia zadania. Ta wartość musi dokładnie odpowiadać; wyszukiwanie rozmyte ani wyszukiwanie po nazwie nie są obsługiwane.

## Przykłady

### Przykład 1: anulowanie działającego zadania cyklicznego

Zadanie cykliczne zostało wcześniej utworzone z identyfikatorem `"cron_abc123"`. Użytkownik prosi o jego zatrzymanie.

```
CronDelete({ id: "cron_abc123" })
```

Zadanie zostaje usunięte z magazynu sesji i nie będzie już uruchamiane.

### Przykład 2: usunięcie nieaktualnego zadania jednorazowego przed uruchomieniem

Zadanie jednorazowe z identyfikatorem `"cron_xyz789"` zostało zaplanowane do uruchomienia za 30 minut, ale użytkownik zdecydował, że nie jest już potrzebne.

```
CronDelete({ id: "cron_xyz789" })
```

Zadanie zostaje anulowane. Żadna akcja nie zostanie wykonana po osiągnięciu pierwotnego czasu wyzwalania.

## Uwagi

- `id` musi zostać uzyskany z wartości zwracanej przez `CronCreate`. Nie ma możliwości wyszukania zadania po opisie lub wywołaniu zwrotnym — zapisz identyfikator, jeśli może być konieczne późniejsze anulowanie.
- Jeśli zadanie zostało już automatycznie usunięte (uruchomione jako zadanie jednorazowe lub osiągnęło cykliczne wygaśnięcie po 7 dniach), wywołanie `CronDelete` z tym identyfikatorem jest operacją bez efektu i nie spowoduje błędu.
- `CronDelete` wpływa tylko na bieżącą sesję w pamięci. Jeśli środowisko uruchomieniowe nie utrwala stanu cron między restartami, zaplanowane zadania zostaną utracone po restarcie niezależnie od tego, czy `CronDelete` zostało wywołane.
- Nie ma operacji zbiorczego usuwania; anuluj każde zadanie indywidualnie, używając jego własnego `id`.
