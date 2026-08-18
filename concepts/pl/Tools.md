# Przegląd narzędzi Claude Code

Claude Code udostępnia modelowi zestaw wbudowanych narzędzi poprzez mechanizm tool_use API Anthropic. Tablica `tools` w każdym żądaniu MainAgent zawiera pełne definicje JSON Schema tych narzędzi, a model wywołuje je w odpowiedzi poprzez bloki content `tool_use`.

Poniżej znajduje się kategoryzowany indeks wszystkich narzędzi.

## System agentów

| Narzędzie | Przeznaczenie |
|------|------|
| [Agent](Tool-Agent.md) | Uruchomienie sub-agenta (SubAgent) do obsługi złożonych wieloetapowych zadań |
| [TaskOutput](Tool-TaskOutput.md) | Pobranie wyniku zadania w tle |
| [TaskStop](Tool-TaskStop.md) | Zatrzymanie działającego zadania w tle |
| [TaskCreate](Tool-TaskCreate.md) | Utworzenie wpisu na strukturalnej liście zadań |
| [TaskGet](Tool-TaskGet.md) | Pobranie szczegółów zadania |
| [TaskUpdate](Tool-TaskUpdate.md) | Aktualizacja statusu zadania, zależności itp. |
| [TaskList](Tool-TaskList.md) | Wyświetlenie listy wszystkich zadań |
| [ListAgents](Tool-ListAgents.md) | Wyświetlenie listy agentów dostępnych w sesji |

## Zespół i koordynacja

| Narzędzie | Przeznaczenie |
|------|------|
| [SendMessage](Tool-SendMessage.md) | Wysyłanie wiadomości do innego agenta |
| [Workflow](Tool-Workflow.md) | Uruchomienie deterministycznego skryptu orkestracji wieloagentowej |
| [Monitor](Tool-Monitor.md) | Strumieniowanie zdarzeń z długo działającego skryptu jako powiadomienia |
| [SendFile](Tool-SendFile.md) | Wysyłanie plików do innej sesji Claude Code |
| [SendUserFile](Tool-SendUserFile.md) | Wysyłanie plików do użytkownika |
| [SendUserMessage](Tool-SendUserMessage.md) | Wysyłanie wiadomości do użytkownika (starsze narzędzie Brief) |
| [EndConversation](Tool-EndConversation.md) | Zakończenie bieżącej rozmowy |

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
| [ToolSearch](Tool-ToolSearch.md) | Wyszukiwanie i ładowanie odroczonych/MCP narzędzi na żądanie |

## Terminal

| Narzędzie | Przeznaczenie |
|------|------|
| [Bash](Tool-Bash.md) | Wykonywanie poleceń shell |
| [REPL](Tool-REPL.md) | Uruchamianie JavaScriptu w trwałym REPL Node.js |

## Web

| Narzędzie | Przeznaczenie |
|------|------|
| [WebFetch](Tool-WebFetch.md) | Pobieranie zawartości stron internetowych i przetwarzanie przez AI |
| [WebSearch](Tool-WebSearch.md) | Zapytania do wyszukiwarki |
| [Artifact](Tool-Artifact.md) | Publikowanie pliku HTML/Markdown jako hostowanej strony internetowej claude.ai |
| [DesignSync](Tool-DesignSync.md) | Synchronizacja lokalnej biblioteki komponentów z projektem systemu projektowania claude.ai |

## Planowanie i interakcja

| Narzędzie | Przeznaczenie |
|------|------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | Wejście w tryb planowania, projektowanie planu wdrożenia |
| [ExitPlanMode](Tool-ExitPlanMode.md) | Wyjście z trybu planowania i przesłanie planu do zatwierdzenia przez użytkownika |
| [AskUserQuestion](Tool-AskUserQuestion.md) | Zadanie pytania użytkownikowi w celu uzyskania wyjaśnienia lub decyzji |
| [ReportFindings](Tool-ReportFindings.md) | Raportowanie ustaleń przeglądu kodu jako typizowana lista dla interfejsu użytkownika hosta |
| [TodoWrite](Tool-TodoWrite.md) | Zapisanie strukturalnej listy todo dla sesji |
| [SendFeedback](Tool-SendFeedback.md) | Wysyłanie ustrukturyzowanej opinii o Claude Code do Anthropic |
| [Projects](Tool-Projects.md) | Zarządzanie dokumentami bazy wiedzy projektu |
| [ProposeGoal](Tool-ProposeGoal.md) | Zaproponowanie weryfikowalnego celu ukończenia sesji |

## Drzewa robocze

| Narzędzie | Przeznaczenie |
|------|------|
| [EnterWorktree](Tool-EnterWorktree.md) | Tworzenie lub wejście do izolowanego worktree git na czas sesji |
| [ExitWorktree](Tool-ExitWorktree.md) | Opuszczenie sesji worktree, zachowując lub usuwając ją |

## Planowanie i powiadomienia

| Narzędzie | Przeznaczenie |
|------|------|
| [CronCreate](Tool-CronCreate.md) | Zaplanowanie monitu na wyrażeniu cron (powtarzające się lub jednorazowe) |
| [CronDelete](Tool-CronDelete.md) | Anulowanie zaplanowanego zadania cron |
| [CronList](Tool-CronList.md) | Wyświetlenie listy zaplanowanych zadań cron |
| [ScheduleWakeup](Tool-ScheduleWakeup.md) | Samowykona /loop iteracji poprzez zaplanowanie następnego przebudzenia |
| [PushNotification](Tool-PushNotification.md) | Wysłanie powiadomienia na pulpicie/urządzeniu mobilnym do użytkownika |
| [RemoteTrigger](Tool-RemoteTrigger.md) | Zarządzanie rutynami remote-trigger claude.ai |
| [ReadNotifications](Tool-ReadNotifications.md) | Odczytanie oczekujących powiadomień sesji |

## Rozszerzenia

| Narzędzie | Przeznaczenie |
|------|------|
| [Skill](Tool-Skill.md) | Wykonanie umiejętności (slash command) |

## MCP i rozszerzenia

| Narzędzie | Przeznaczenie |
|------|------|
| [ListMcpResources](Tool-ListMcpResources.md) | Wyświetlenie zasobów udostępnianych przez podłączone serwery MCP |
| [ReadMcpResource](Tool-ReadMcpResource.md) | Odczyt pojedynczego zasobu serwera MCP po URI |
| [ReadMcpResourceDir](Tool-ReadMcpResourceDir.md) | Wyświetlenie katalogowego zasobu MCP po URI |
| [SearchMcpRegistry](Tool-SearchMcpRegistry.md) | Wyszukiwanie rejestru konektorów MCP po słowach kluczowych |
| [SuggestConnectors](Tool-SuggestConnectors.md) | Pobranie szczegółów konektorów z wyników wyszukiwania w rejestrze |
| [ListConnectors](Tool-ListConnectors.md) | Wyświetlenie zainstalowanych konektorów MCP |
| [SuggestPluginInstall](Tool-SuggestPluginInstall.md) | Wyrenderowanie wbudowanej karty instalacji wtyczki |
| [SuggestSkills](Tool-SuggestSkills.md) | Wyrenderowanie karty skilli możliwych do dodania |
| [ListPlugins](Tool-ListPlugins.md) | Wyświetlenie włączonych wtyczek claude.ai |
| [ListSkills](Tool-ListSkills.md) | Wyświetlenie włączonych skilli claude.ai |

## Integracja z IDE

| Narzędzie | Przeznaczenie |
|------|------|
| [LSP](Tool-LSP.md) | Zapytania serwera językowego (definicje, odwołania, symbole) |
