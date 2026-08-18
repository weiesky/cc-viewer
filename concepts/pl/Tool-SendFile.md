# SendFile

Wysyła jeden lub więcej plików do innej sesji Claude Code — sesji równorzędnej wylistowanej przez `ListAgents` lub jawnemu adresowi sesji.

## Kiedy używać

- Sesja równorzędna potrzebuje pliku z Twojego katalogu roboczego (raportu, łatki, fixture) do kontynuowania własnego zadania.
- Koordynujesz pracę między sesjami i chcesz przekazać artefakty, nie tylko tekst (dla tekstu użyj `SendMessage`).

## Aktywacja

- Przesyłanie plików między sesjami musi być dostępne w sesji; gdy nie jest, walidacja kończy się komunikatem "Cross-session file transfer is not available in this session."
- Bramkowane tymi samymi warunkami wysyłania wiadomości między sesjami co `ListAgents` (flagi funkcji po stronie serwera, domyślnie wyłączone).

## Parametry

- `to` (string, wymagany): Odbiorca — nazwa sesji równorzędnej z `ListAgents` lub jawny adres `uds:<socket>` / `bridge:<session id>`.
- `files` (tablica stringów, wymagany): Ścieżki plików (bezwzględne lub względem katalogu roboczego) do wysłania. Zawsze przekazuj tablicę, nawet dla pojedynczego pliku. 1–16 plików, maksymalnie 30 MiB każdy.
- `message` (string, opcjonalny): Krótka wiadomość dostarczana wraz z plikami.

## Przykłady

### Przykład 1: Wysłanie raportu do sesji równorzędnej

```
SendFile(
  to="teammate-a",
  files=["./dist/report.html"],
  message="The analysis you asked for"
)
```

## Uwagi

- Transfery na zdalne maszyny mogą wymagać dodatkowego zatwierdzenia.
- Odczyt zawartości pliku jest częścią wysyłania — odmówiony, jeśli odczyt plików jest zablokowany przez reguły uprawnień.
