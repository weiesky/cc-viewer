# TeamDelete

## Definition

Fjerner et team og dets tilknyttede opgavemapper når multi-agent-samarbejdsarbejdet er afsluttet. Dette er oprydningsmodstykket til TeamCreate.

## Adfærd

- Fjerner team-mappen: `~/.claude/teams/{team-name}/`
- Fjerner opgavelistemappen: `~/.claude/tasks/{team-name}/`
- Rydder team-konteksten fra den aktuelle session

**Vigtigt**: TeamDelete fejler hvis teamet stadig har aktive medlemmer. Teammedlemmer skal først lukkes ned korrekt via SendMessage shutdown-anmodninger.

## Typisk anvendelse

TeamDelete kaldes i slutningen af en team-arbejdsgang:

1. Alle opgaver er fuldført
2. Teammedlemmer lukkes ned via `SendMessage` med `shutdown_request`
3. **TeamDelete** fjerner team- og opgavemapper

## Relaterede værktøjer

| Værktøj | Formål |
|---------|--------|
| `TeamCreate` | Opret et nyt team og dets opgaveliste |
| `SendMessage` | Kommuniker med teammedlemmer / send shutdown-anmodninger |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | Administrer den delte opgaveliste |
| `Agent` | Start teammedlemmer der tilslutter sig teamet |
