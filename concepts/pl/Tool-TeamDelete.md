# TeamDelete

## Definicja

Usuwa zespół i powiązane katalogi zadań po zakończeniu pracy w ramach współpracy wielu agentów. Jest to odpowiednik porządkujący dla TeamCreate.

## Zachowanie

- Usuwa katalog zespołu: `~/.claude/teams/{team-name}/`
- Usuwa katalog listy zadań: `~/.claude/tasks/{team-name}/`
- Czyści kontekst zespołu z bieżącej sesji

**Ważne**: TeamDelete zakończy się błędem, jeśli zespół nadal ma aktywnych członków. Członkowie zespołu muszą najpierw zostać poprawnie zamknięci za pomocą żądań shutdown wysyłanych przez SendMessage.

## Typowe użycie

TeamDelete jest wywoływany na końcu przepływu pracy zespołu:

1. Wszystkie zadania są ukończone
2. Członkowie zespołu są zamykani przez `SendMessage` z `shutdown_request`
3. **TeamDelete** usuwa katalogi zespołu i zadań

## Powiązane narzędzia

| Narzędzie | Przeznaczenie |
|-----------|---------------|
| `TeamCreate` | Utwórz nowy zespół i jego listę zadań |
| `SendMessage` | Komunikacja z członkami zespołu / wysyłanie żądań shutdown |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | Zarządzanie wspólną listą zadań |
| `Agent` | Uruchom członków zespołu dołączających do zespołu |
