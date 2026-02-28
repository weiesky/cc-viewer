# Agent

## Definicja

Uruchamia sub-agenta (SubAgent) do autonomicznego przetwarzania złożonych wieloetapowych zadań. Sub-agent to niezależny podproces z własnym zestawem narzędzi i kontekstem. Agent to przemianowana wersja narzędzia Task w nowszych wersjach Claude Code.

## Parametry

| Parametr | Typ | Wymagany | Opis |
|------|------|------|------|
| `prompt` | string | Tak | Opis zadania do wykonania przez sub-agenta |
| `description` | string | Tak | Krótkie podsumowanie w 3-5 słowach |
| `subagent_type` | string | Tak | Typ sub-agenta, określa dostępny zestaw narzędzi |
| `model` | enum | Nie | Określenie modelu (sonnet / opus / haiku), domyślnie dziedziczony od rodzica |
| `max_turns` | integer | Nie | Maksymalna liczba tur agentowych |
| `run_in_background` | boolean | Nie | Czy uruchomić w tle, zadanie w tle zwraca ścieżkę output_file |
| `resume` | string | Nie | ID agenta do wznowienia, kontynuacja od ostatniego wykonania. Przydatne do wznowienia poprzedniego sub-agenta bez utraty kontekstu |
| `isolation` | enum | Nie | Tryb izolacji, `worktree` tworzy tymczasowy git worktree |

## Typy sub-agentów

| Typ | Przeznaczenie | Dostępne narzędzia |
|------|------|----------|
| `Bash` | Wykonywanie poleceń, operacje git | Bash |
| `general-purpose` | Ogólne wieloetapowe zadania | Wszystkie narzędzia |
| `Explore` | Szybka eksploracja bazy kodu | Wszystkie narzędzia oprócz Agent/Edit/Write/NotebookEdit/ExitPlanMode |
| `Plan` | Projektowanie planu wdrożenia | Wszystkie narzędzia oprócz Agent/Edit/Write/NotebookEdit/ExitPlanMode |
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
- Można równolegle uruchamiać wiele wywołań Agent w jednej wiadomości dla zwiększenia wydajności
- Postęp zadań w tle sprawdza się za pomocą narzędzia TaskOutput
- Typ Explore jest wolniejszy niż bezpośrednie wywołanie Glob/Grep, używaj tylko gdy proste wyszukiwanie nie wystarcza
- Używaj `run_in_background: true` dla długotrwałych zadań niewymagających natychmiastowego wyniku; używaj trybu pierwszoplanowego (domyślnego) gdy wynik jest potrzebny przed kontynuacją
- Parametr `resume` pozwala kontynuować wcześniej rozpoczętą sesję sub-agenta, zachowując zgromadzony kontekst

## Znaczenie w cc-viewer

Agent to nowa nazwa narzędzia Task w najnowszych wersjach Claude Code. Wywołanie Agent generuje łańcuch żądań SubAgent, widoczny na liście żądań jako niezależna sekwencja podzapytań oddzielona od MainAgent. Żądania SubAgent zazwyczaj mają uproszczony system prompt i mniej definicji narzędzi, co wyraźnie odróżnia je od MainAgent. W cc-viewer mogą pojawiać się nazwy narzędzi `Task` lub `Agent` w zależności od wersji Claude Code użytej w nagranej rozmowie.
