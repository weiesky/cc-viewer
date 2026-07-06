# Przegląd narzędzi Claude Code

Claude Code udostępnia modelowi zestaw wbudowanych narzędzi poprzez mechanizm tool_use API Anthropic. Tablica `tools` w każdym żądaniu MainAgent zawiera pełne definicje JSON Schema tych narzędzi, a model wywołuje je w odpowiedzi poprzez bloki content `tool_use`.

Poniżej znajduje się kategoryzowany indeks wszystkich narzędzi.

## System agentów

| Narzędzie | Przeznaczenie |
|------|------|
| [Task](Tool-Task.md) | Uruchomienie sub-agenta (SubAgent) do obsługi złożonych wieloetapowych zadań |
| [TaskOutput](Tool-TaskOutput.md) | Pobranie wyniku zadania w tle |
| [TaskStop](Tool-TaskStop.md) | Zatrzymanie działającego zadania w tle |
| [TaskCreate](Tool-TaskCreate.md) | Utworzenie wpisu na strukturalnej liście zadań |
| [TaskGet](Tool-TaskGet.md) | Pobranie szczegółów zadania |
| [TaskUpdate](Tool-TaskUpdate.md) | Aktualizacja statusu zadania, zależności itp. |
| [TaskList](Tool-TaskList.md) | Wyświetlenie listy wszystkich zadań |

## Operacje na plikach

| Narzędzie | Przeznaczenie |
|------|------|
| [Read](Tool-Read.md) | Odczyt zawartości pliku (obsługa tekstu, obrazów, PDF, Jupyter notebook) |
| [Edit](Tool-Edit.md) | Edycja pliku przez precyzyjne zastępowanie ciągów znaków |
| [Write](Tool-Write.md) | Zapis lub nadpisanie pliku |
| [NotebookEdit](Tool-NotebookEdit.md) | Edycja komórek Jupyter notebook |

## Wyszukiwanie

| Narzędzie | Przeznaczenie |
|------|------|
| [Glob](Tool-Glob.md) | Wyszukiwanie plików według wzorca nazwy |
| [Grep](Tool-Grep.md) | Wyszukiwanie zawartości plików oparte na ripgrep |

## Terminal

| Narzędzie | Przeznaczenie |
|------|------|
| [Bash](Tool-Bash.md) | Wykonywanie poleceń shell |

## Web

| Narzędzie | Przeznaczenie |
|------|------|
| [WebFetch](Tool-WebFetch.md) | Pobieranie zawartości stron internetowych i przetwarzanie przez AI |
| [WebSearch](Tool-WebSearch.md) | Zapytania do wyszukiwarki |

## Planowanie i interakcja

| Narzędzie | Przeznaczenie |
|------|------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | Wejście w tryb planowania, projektowanie planu wdrożenia |
| [ExitPlanMode](Tool-ExitPlanMode.md) | Wyjście z trybu planowania i przesłanie planu do zatwierdzenia przez użytkownika |
| [AskUserQuestion](Tool-AskUserQuestion.md) | Zadanie pytania użytkownikowi w celu uzyskania wyjaśnienia lub decyzji |

## Rozszerzenia

| Narzędzie | Przeznaczenie |
|------|------|
| [Skill](Tool-Skill.md) | Wykonanie umiejętności (slash command) |

## Integracja z IDE

| Narzędzie | Przeznaczenie |
|------|------|
| [getDiagnostics](Tool-getDiagnostics.md) | Pobranie informacji diagnostycznych języka z VS Code |
| [executeCode](Tool-executeCode.md) | Wykonanie kodu w jądrze Jupyter |
