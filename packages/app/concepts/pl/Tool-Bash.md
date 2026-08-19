# Bash

Uruchamia polecenie powłoki w trwałym katalogu roboczym i zwraca jego stdout/stderr. Najlepiej zarezerwowane dla operacji, których nie może wyrazić żadne dedykowane narzędzie Claude Code, takich jak uruchamianie git, npm, docker czy skryptów kompilacji.

## Kiedy używać

- Wykonywanie operacji git (`git status`, `git diff`, `git commit`, `gh pr create`)
- Uruchamianie menedżerów pakietów i narzędzi kompilacji (`npm install`, `npm run build`, `pytest`, `cargo build`)
- Uruchamianie długo działających procesów (serwery deweloperskie, obserwatory) w tle za pomocą `run_in_background`
- Wywoływanie CLI specyficznych dla domeny (`docker`, `terraform`, `kubectl`, `gh`), które nie mają wbudowanego odpowiednika
- Łączenie zależnych kroków za pomocą `&&`, gdy kolejność ma znaczenie

## Parametry

- `command` (string, wymagany): Dokładne polecenie powłoki do wykonania.
- `description` (string, wymagany): Krótkie podsumowanie w stronie czynnej (5–10 słów dla prostych poleceń; więcej kontekstu dla potokowanych lub nietypowych).
- `timeout` (liczba, opcjonalny): Limit czasu w milisekundach, maksymalnie `600000` (10 minut). Domyślnie `120000` (2 minuty).
- `run_in_background` (boolean, opcjonalny): Gdy `true`, polecenie działa w tle, a Ty otrzymujesz powiadomienie po zakończeniu. Nie dopisuj `&` samodzielnie.

## Przykłady

### Przykład 1: Sprawdź stan repozytorium przed commitem
Wywołaj `git status` i `git diff --stat` jako dwa równoległe wywołania `Bash` w tej samej wiadomości, aby szybko zebrać kontekst, a następnie złożyć commit w kolejnym wywołaniu.

### Przykład 2: Połącz zależne kroki kompilacji
Użyj jednego wywołania, takiego jak `npm ci && npm run build && npm test`, aby każdy krok uruchamiał się dopiero po sukcesie poprzedniego. Używaj `;` tylko wtedy, gdy celowo chcesz, aby kolejne kroki uruchamiały się także po niepowodzeniach.

### Przykład 3: Długo działający serwer deweloperski
Wywołaj `npm run dev` z `run_in_background: true`. Otrzymasz powiadomienie po zakończeniu. Nie odpytuj w pętlach `sleep`; zamiast tego diagnozuj błędy.

## Uwagi

- Katalog roboczy jest trwały między wywołaniami, ale stan powłoki (wyeksportowane zmienne, funkcje powłoki, aliasy) nie jest. Preferuj ścieżki bezwzględne i unikaj `cd`, chyba że użytkownik tego zażąda.
- Preferuj dedykowane narzędzia nad potokowymi odpowiednikami powłoki: `Glob` zamiast `find`/`ls`, `Grep` zamiast `grep`/`rg`, `Read` zamiast `cat`/`head`/`tail`, `Edit` zamiast `sed`/`awk`, `Write` zamiast `echo >` lub heredoców, oraz zwykły tekst asystenta zamiast `echo`/`printf` dla wyjścia widocznego dla użytkownika.
- Cytuj każdą ścieżkę zawierającą spacje w podwójnych cudzysłowach (na przykład `"/Users/me/My Project/file.txt"`).
- Dla niezależnych poleceń wykonaj wiele wywołań `Bash` równolegle w jednej wiadomości. Łącz z `&&` tylko wtedy, gdy jedno polecenie zależy od drugiego.
- Wyjście powyżej 30000 znaków jest obcinane. Przy przechwytywaniu dużych logów przekieruj je do pliku, a następnie odczytaj narzędziem `Read`.
- Nigdy nie używaj interaktywnych flag, takich jak `git rebase -i` czy `git add -i`; nie mogą one otrzymać wejścia przez to narzędzie.
- Nie pomijaj hooków git (`--no-verify`, `--no-gpg-sign`) ani nie wykonuj destrukcyjnych operacji (`reset --hard`, `push --force`, `clean -f`), chyba że użytkownik wyraźnie tego zażąda.
