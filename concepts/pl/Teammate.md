# Teammate

## Definicja

Teammate to agent współpracujący w trybie Claude Code Agent Team. Gdy główny agent tworzy zespół za pomocą `TeamCreate` i generuje teammate'ów przy użyciu narzędzia `Agent`, każdy teammate działa jako niezależny proces agenta z własnym oknem kontekstu i zestawem narzędzi, komunikując się z członkami zespołu za pośrednictwem `SendMessage`.

## Różnice w porównaniu z SubAgent

| Cecha | Teammate | SubAgent |
|-------|----------|----------|
| Cykl życia | Trwały, może odbierać wiele wiadomości | Jednorazowe zadanie, niszczony po zakończeniu |
| Komunikacja | SendMessage — wiadomości dwukierunkowe | Rodzic→dziecko — wywołanie jednokierunkowe, zwraca wynik |
| Kontekst | Niezależny pełny kontekst, zachowywany między turami | Izolowany kontekst zadania |
| Model współpracy | Współpraca zespołowa, wzajemna komunikacja | Struktura hierarchiczna, interakcja tylko z agentem nadrzędnym |
| Typ zadania | Złożone zadania wieloetapowe | Pojedyncze zadania, takie jak wyszukiwanie i eksploracja |

## Zachowanie

- Tworzony przez głównego agenta (team lead) za pomocą narzędzia `Agent` z przypisanym `team_name`
- Współdzieli listę zadań przez `TaskList` / `TaskGet` / `TaskUpdate`
- Po każdej rundzie wykonania przechodzi w stan idle i czeka na przebudzenie przez nowe wiadomości
- Może zostać elegancko zakończony za pomocą `shutdown_request`

## Opis panelu statystyk

Panel statystyk teammate'ów wyświetla liczbę wywołań API dla każdego teammate'a. Kolumna `Name` to nazwa teammate'a (np. `reviewer-security`, `reviewer-pipeline`), a kolumna `Liczba` to łączna liczba żądań API wygenerowanych przez danego teammate'a.
