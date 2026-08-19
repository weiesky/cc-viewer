# EnterWorktree

Tworzy izolowany worktree Git na nowej gałęzi lub przełącza sesję do istniejącego worktree bieżącego repozytorium, aby praca równoległa lub eksperymentalna mogła przebiegać bez wpływu na główny checkout.

## Kiedy używać

- Użytkownik wyraźnie mówi "worktree" — na przykład "zacznij worktree", "utwórz worktree" lub "pracuj w worktree".
- Instrukcje projektu w `CLAUDE.md` lub trwałej pamięci nakazują użycie worktree dla bieżącego zadania.
- Chcesz kontynuować zadanie, które wcześniej zostało skonfigurowane jako worktree (przekaż `path`, aby ponownie do niego wejść).
- Wiele gałęzi eksperymentalnych musi współistnieć na dysku bez ciągłych przełączeń checkoutu.
- Długo działające zadanie powinno być odizolowane od niezwiązanych edycji w głównym drzewie roboczym.

## Parametry

- `name` (string, opcjonalny): Nazwa nowego katalogu worktree. Każdy segment oddzielony `/` może zawierać tylko litery, cyfry, kropki, podkreślenia i myślniki; cały ciąg jest ograniczony do 64 znaków. Jeśli pominięty, a `path` również jest pominięty, generowana jest losowa nazwa. Wyklucza się wzajemnie z `path`.
- `path` (string, opcjonalny): Ścieżka systemu plików istniejącego worktree bieżącego repozytorium, do którego należy się przełączyć. Musi pojawiać się w `git worktree list` dla tego repo; ścieżki, które nie są zarejestrowanymi worktree bieżącego repozytorium, są odrzucane. Wyklucza się wzajemnie z `name`.

## Przykłady

### Przykład 1: Utwórz nowy worktree z opisową nazwą

```
EnterWorktree(name="feat/okta-sso")
```

Tworzy `.claude/worktrees/feat/okta-sso` na nowej gałęzi opartej na `HEAD`, a następnie przełącza katalog roboczy sesji do tego worktree. Wszystkie kolejne edycje plików i polecenia powłoki działają wewnątrz tego worktree, aż wyjdziesz.

### Przykład 2: Ponownie wejdź do istniejącego worktree

```
EnterWorktree(path="/Users/me/repo/.claude/worktrees/feat/okta-sso")
```

Wznawia pracę w wcześniej utworzonym worktree. Ponieważ wszedłeś do niego przez `path`, `ExitWorktree` nie usunie go automatycznie — wyjście z `action: "keep"` po prostu wraca do pierwotnego katalogu.

## Uwagi

- Nie wywołuj `EnterWorktree`, chyba że użytkownik wyraźnie o to poprosił lub instrukcje projektu tego wymagają. Zwykłe przełączanie gałęzi lub prośby o naprawę błędów powinny używać normalnych poleceń Git, a nie worktree.
- Wywoływany wewnątrz repozytorium Git, narzędzie tworzy worktree w `.claude/worktrees/` i rejestruje nową gałąź opartą na `HEAD`. Poza repozytorium Git deleguje do skonfigurowanych hooków `WorktreeCreate` / `WorktreeRemove` w `settings.json` dla izolacji niezależnej od VCS.
- W danym momencie aktywna jest tylko jedna sesja worktree. Narzędzie odmawia uruchomienia, jeśli już jesteś w sesji worktree; najpierw wyjdź za pomocą `ExitWorktree`.
- Użyj `ExitWorktree`, aby opuścić worktree w trakcie sesji. Jeśli sesja zakończy się, gdy wciąż jesteś w nowo utworzonym worktree, użytkownik zostanie zapytany, czy go zachować, czy usunąć.
- Worktree, do których wszedłeś przez `path`, są traktowane jako zewnętrzne — `ExitWorktree` z `action: "remove"` ich nie usunie. Jest to zabezpieczenie chroniące worktree, którymi użytkownik zarządza ręcznie.
- Nowy worktree dziedziczy zawartość bieżącej gałęzi, ale ma niezależny katalog roboczy i indeks. Zmiany zindeksowane i niezindeksowane w głównym checkoucie nie są widoczne wewnątrz worktree.
- Wskazówka dotycząca nazewnictwa: prefiksuj rodzajem pracy (`feat/`, `fix/`, `spike/`), aby wiele równoczesnych worktree łatwo odróżniało się w `git worktree list`.
