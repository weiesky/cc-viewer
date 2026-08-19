# ExitWorktree

Kończy sesję worktree utworzoną wcześniej przez `EnterWorktree` i przywraca sesję do oryginalnego katalogu roboczego. To narzędzie działa wyłącznie na worktree utworzonych przez `EnterWorktree` w bieżącej sesji; jeśli żadna taka sesja nie jest aktywna, wywołanie nie ma żadnego efektu.

## Kiedy używać

- Praca w izolowanym worktree została zakończona i chcesz wrócić do głównego katalogu roboczego.
- Zadanie w worktree gałęzi funkcji zostało ukończone i po scaleniu chcesz oczyścić gałąź i katalog.
- Chcesz zachować worktree do późniejszego użytku i po prostu wrócić do oryginalnego katalogu bez usuwania czegokolwiek.
- Chcesz porzucić eksperymentalną lub tymczasową gałąź bez zostawiania artefaktów na dysku.
- Musisz rozpocząć nową sesję `EnterWorktree`, co wymaga najpierw wyjścia z bieżącej.

## Parametry

- `action` (ciąg znaków, wymagany): `"keep"` zachowuje katalog worktree i gałąź na dysku, aby można było do nich wrócić później; `"remove"` usuwa zarówno katalog, jak i gałąź, wykonując czyste wyjście.
- `discard_changes` (wartość logiczna, opcjonalna, domyślnie `false`): Istotna tylko wtedy, gdy `action` ma wartość `"remove"`. Jeśli worktree zawiera niezatwierdzone pliki lub commity nieobecne w oryginalnej gałęzi, narzędzie odmówi usunięcia, o ile `discard_changes` nie zostanie ustawione na `true`. Odpowiedź z błędem wymienia konkretne zmiany, aby można było potwierdzić z użytkownikiem przed ponownym wywołaniem.

## Przykłady

### Przykład 1: czyste wyjście po scaleniu zmian

Po ukończeniu pracy w worktree i scaleniu gałęzi z main wywołaj `ExitWorktree` z `action: "remove"`, aby usunąć katalog worktree i gałąź oraz wrócić do oryginalnego katalogu roboczego.

```
ExitWorktree(action: "remove")
```

### Przykład 2: odrzucenie tymczasowego worktree z niezatwierdzonymi eksperymentalnymi zmianami

Jeśli worktree zawiera eksperymentalne, niezatwierdzone zmiany, które mają zostać całkowicie odrzucone, najpierw spróbuj `action: "remove"`. Narzędzie odmówi i wyświetli listę niezatwierdzonych zmian. Po potwierdzeniu z użytkownikiem, że zmiany mogą zostać odrzucone, wywołaj ponownie z `discard_changes: true`.

```
ExitWorktree(action: "remove", discard_changes: true)
```

## Uwagi

- To narzędzie działa wyłącznie na worktree utworzonych przez `EnterWorktree` w bieżącej sesji. Nie wpłynie na worktree utworzone za pomocą `git worktree add`, worktree z poprzednich sesji ani na zwykły katalog roboczy, jeśli `EnterWorktree` nigdy nie został wywołany — w tych przypadkach wywołanie nie ma żadnego efektu.
- `action: "remove"` zostanie odrzucone, jeśli worktree ma niezatwierdzone zmiany lub commity nieobecne w oryginalnej gałęzi, chyba że jawnie podano `discard_changes: true`. Zawsze potwierdzaj z użytkownikiem przed ustawieniem `discard_changes: true`, ponieważ danych nie można odzyskać.
- Jeśli do worktree była dołączona sesja tmux: przy `remove` zostaje ona zakończona; przy `keep` nadal działa, a jej nazwa jest zwracana, aby użytkownik mógł się ponownie połączyć później.
- Po zakończeniu `ExitWorktree` można ponownie wywołać `EnterWorktree`, aby rozpocząć nową sesję worktree.
