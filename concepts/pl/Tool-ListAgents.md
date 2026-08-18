# ListAgents

Wyświetla listę agentów, do których możesz wysłać `SendMessage`: subagentów w procesie, których uruchomiłeś, inne lokalne sesje Claude na tej maszynie, Twoje sesje w chmurze (gdy ta sesja ma dostęp do chmury) oraz — gdy Remote Control jest podłączony — inne sesje Twojego konta. Każdy wiersz jest oznaczony rodzajem.

## Kiedy używać

- Potrzebujesz dokładnej nazwy sesji równorzędnej lub subagenta przed wysłaniem do niego wiadomości.
- Chcesz zobaczyć, które sesje są obecnie osiągalne z tej sesji.

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
- Dostępność zależy od konfiguracji sesji (wysyłanie wiadomości między sesjami to funkcja bramkowana).
