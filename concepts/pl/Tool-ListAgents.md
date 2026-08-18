# ListAgents

Wyświetla listę agentów, do których możesz wysłać `SendMessage`: subagentów w procesie, których uruchomiłeś, inne lokalne sesje Claude na tej maszynie, Twoje sesje w chmurze (gdy ta sesja ma dostęp do chmury) oraz — gdy Remote Control jest podłączony — inne sesje Twojego konta. Każdy wiersz jest oznaczony rodzajem.

## Kiedy używać

- Potrzebujesz dokładnej nazwy sesji równorzędnej lub subagenta przed wysłaniem do niego wiadomości.
- Chcesz zobaczyć, które sesje są obecnie osiągalne z tej sesji.

## Aktywacja

- Wymaga Claude Code 2.1.224+ oraz wysyłania wiadomości między sesjami (flaga funkcji po stronie serwera, domyślnie wyłączona).
- Wysyłanie wiadomości między sesjami jest niedostępne na Amazon Bedrock, Claude Platform on AWS, Google Cloud Agent Platform i Microsoft Foundry.
- Wyłączone, gdy ustawione jest `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_TELEMETRY`, `DO_NOT_TRACK` lub `DISABLE_GROWTHBOOK`.
- Wymuś włączenie przez `CLAUDE_CODE_HARBOR_KITE=1`.

## Parametry

- `channel` (string, opcjonalny): Niedostępny w tej wersji; pozostaw nieustawiony.
- `q` (string, opcjonalny): Niedostępny w tej wersji; pozostaw nieustawiony.

## Przykłady

### Przykład 1: Wyświetlenie osiągalnych agentów

```
ListAgents()
```

Każdy wiersz wypisuje nazwę — ta nazwa jest adresem. Wyślij za pomocą `SendMessage({to: "<name>", message: "..."})`, kopiując nazwę dokładnie tak, jak została wypisana. Dopisz ` [ref]` z wiersza tylko wtedy, gdy sama nazwa jest niejednoznaczna (dwa wiersze ją współdzielą lub błąd prosi o ujednoznacznienie).

## Uwagi

- Tylko do odczytu i bezpieczne przy współbieżności.
- Sesja w chmurze otrzymuje Twoją wiadomość, ale nie może jeszcze odpowiedzieć — przeczytaj jej odpowiedź w jej własnym transkrypcie.
