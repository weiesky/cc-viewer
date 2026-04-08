# TeamCreate

## Definition

Opretter et nyt team til at koordinere flere agenter, der arbejder på et projekt. Teams muliggør parallel opgaveudførelse via en delt opgaveliste og kommunikation mellem agenter.

## Parametre

| Parameter | Type | Påkrævet | Beskrivelse |
|-----------|------|----------|-------------|
| `team_name` | string | Ja | Navn til det nye team |
| `description` | string | Nej | Teambeskrivelse / formål |
| `agent_type` | string | Nej | Type / rolle for teamlederen |

## Hvad der oprettes

- **Team-konfigurationsfil**: `~/.claude/teams/{team-name}/config.json` — gemmer medlemsliste og metadata
- **Opgavelistemappe**: `~/.claude/tasks/{team-name}/` — delt opgaveliste for alle teammedlemmer

Teams har et 1:1-forhold til opgavelister.

## Team-arbejdsgang

1. **TeamCreate** — opret teamet og dets opgaveliste
2. **TaskCreate** — definer opgaver for teamet
3. **Agent** (med `team_name` + `name`) — start teammedlemmer der tilslutter sig teamet
4. **TaskUpdate** — tildel opgaver til teammedlemmer via `owner`
5. Teammedlemmer arbejder på opgaver og kommunikerer via **SendMessage**
6. Luk teammedlemmer ned når det er færdigt, derefter **TeamDelete** for at rydde op

## Relaterede værktøjer

| Værktøj | Formål |
|---------|--------|
| `TeamDelete` | Fjern team og opgavemapper |
| `SendMessage` | Kommunikation mellem agenter inden for teamet |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | Administrer den delte opgaveliste |
| `Agent` | Start teammedlemmer der tilslutter sig teamet |
