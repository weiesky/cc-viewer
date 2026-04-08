# TeamCreate

## Definicja

Tworzy nowy zespół do koordynacji wielu agentów pracujących nad projektem. Zespoły umożliwiają równoległe wykonywanie zadań poprzez wspólną listę zadań i wymianę wiadomości między agentami.

## Parametry

| Parametr | Typ | Wymagany | Opis |
|----------|-----|----------|------|
| `team_name` | string | Tak | Nazwa nowego zespołu |
| `description` | string | Nie | Opis / cel zespołu |
| `agent_type` | string | Nie | Typ / rola lidera zespołu |

## Co zostaje utworzone

- **Plik konfiguracyjny zespołu**: `~/.claude/teams/{team-name}/config.json` — przechowuje listę członków i metadane
- **Katalog listy zadań**: `~/.claude/tasks/{team-name}/` — wspólna lista zadań dla wszystkich członków zespołu

Zespoły mają relację 1:1 z listami zadań.

## Przepływ pracy zespołu

1. **TeamCreate** — utwórz zespół i jego listę zadań
2. **TaskCreate** — zdefiniuj zadania dla zespołu
3. **Agent** (z `team_name` + `name`) — uruchom członków zespołu dołączających do zespołu
4. **TaskUpdate** — przypisz zadania do członków przez `owner`
5. Członkowie pracują nad zadaniami i komunikują się przez **SendMessage**
6. Zamknij członków po zakończeniu, następnie **TeamDelete** dla porządku

## Powiązane narzędzia

| Narzędzie | Przeznaczenie |
|-----------|---------------|
| `TeamDelete` | Usuń zespół i katalogi zadań |
| `SendMessage` | Komunikacja między agentami w zespole |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | Zarządzanie wspólną listą zadań |
| `Agent` | Uruchom członków zespołu dołączających do zespołu |
