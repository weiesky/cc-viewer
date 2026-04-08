# Task

> **Uwaga:** W nowszych wersjach Claude Code to narzędzie zostało przemianowane na **Agent**. Zobacz dokument [Tool-Agent](Tool-Agent).

## Definicja

Uruchamia sub-agenta (SubAgent) do autonomicznego przetwarzania złożonych wieloetapowych zadań. Sub-agent to niezależny podproces z własnym zestawem narzędzi i kontekstem.

## Parametry

| Parametr | Typ | Wymagany | Opis |
|------|------|------|------|
| `prompt` | string | Tak | Opis zadania do wykonania przez sub-agenta |
| `description` | string | Tak | Krótkie podsumowanie w 3-5 słowach |
| `subagent_type` | string | Tak | Typ sub-agenta, określa dostępny zestaw narzędzi |
| `model` | enum | Nie | Określenie modelu (sonnet / opus / haiku), domyślnie dziedziczony od rodzica |
| `max_turns` | integer | Nie | Maksymalna liczba tur agentowych |
| `run_in_background` | boolean | Nie | Czy uruchomić w tle, zadanie w tle zwraca ścieżkę output_file |
| `resume` | string | Nie | ID agenta do wznowienia, kontynuacja od ostatniego wykonania |
| `isolation` | enum | Nie | Tryb izolacji, `worktree` tworzy tymczasowy git worktree |

## Typy sub-agentów

| Typ | Przeznaczenie | Dostępne narzędzia |
|------|------|----------|
| `Bash` | Wykonywanie poleceń, operacje git | Bash |
| `general-purpose` | Ogólne wieloetapowe zadania | Wszystkie narzędzia |
| `Explore` | Szybka eksploracja bazy kodu | Wszystkie narzędzia oprócz Task/Edit/Write/NotebookEdit/ExitPlanMode |
| `Plan` | Projektowanie planu wdrożenia | Wszystkie narzędzia oprócz Task/Edit/Write/NotebookEdit/ExitPlanMode |
| `claude-code-guide` | Pytania i odpowiedzi dotyczące przewodnika Claude Code | Glob, Grep, Read, WebFetch, WebSearch |
| `statusline-setup` | Konfiguracja paska statusu | Read, Edit |

## Scenariusze użycia

**Odpowiednie zastosowanie:**
- Złożone zadania wymagające wieloetapowego autonomicznego wykonania
- Eksploracja bazy kodu i dogłębne badania (typ Explore)
- Praca równoległa wymagająca izolowanego środowiska
- Długotrwałe zadania wymagające uruchomienia w tle

**Nieodpowiednie zastosowanie:**
- Odczyt określonej ścieżki pliku — bezpośrednio użyj Read lub Glob
- Wyszukiwanie w 2-3 znanych plikach — bezpośrednio użyj Read
- Wyszukiwanie definicji klasy — bezpośrednio użyj Glob

## Uwagi

- Po zakończeniu sub-agent zwraca pojedynczą wiadomość, jego wyniki nie są widoczne dla użytkownika — główny agent musi je przekazać
- Można równolegle uruchamiać wiele wywołań Task w jednej wiadomości dla zwiększenia wydajności
- Postęp zadań w tle sprawdza się za pomocą narzędzia TaskOutput
- Typ Explore jest wolniejszy niż bezpośrednie wywołanie Glob/Grep, używaj tylko gdy proste wyszukiwanie nie wystarcza
