# TeamDelete

## Definisjon

Fjerner et team og tilhørende oppgavemapper når multi-agent-samarbeidsarbeidet er fullført. Dette er oppryddingsmotparten til TeamCreate.

## Atferd

- Fjerner team-mappen: `~/.claude/teams/{team-name}/`
- Fjerner oppgavemappen: `~/.claude/tasks/{team-name}/`
- Tømmer team-kontekst fra gjeldende økt

**Viktig**: TeamDelete vil mislykkes hvis teamet fortsatt har aktive medlemmer. Teammedlemmer må først avsluttes på en kontrollert måte via SendMessage-avslutningsforespørsler.

## Typisk bruk

TeamDelete kalles på slutten av en team-arbeidsflyt:

1. Alle oppgaver er fullført
2. Teammedlemmer avsluttes via `SendMessage` med `shutdown_request`
3. **TeamDelete** fjerner team- og oppgavemapper

## Relaterte verktøy

| Verktøy | Formål |
|---------|--------|
| `TeamCreate` | Opprett et nytt team og dets oppgaveliste |
| `SendMessage` | Kommuniser med teammedlemmer / send avslutningsforespørsler |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | Administrer den delte oppgavelisten |
| `Agent` | Start teammedlemmer som slutter seg til teamet |
