# TeamCreate

## Definisjon

Oppretter et nytt team for å koordinere flere agenter som arbeider på et prosjekt. Team muliggjør parallell oppgavekjøring via en delt oppgaveliste og kommunikasjon mellom agenter.

## Parametere

| Parameter | Type | Påkrevd | Beskrivelse |
|-----------|------|---------|-------------|
| `team_name` | string | Ja | Navn på det nye teamet |
| `description` | string | Nei | Teambeskrivelse / formål |
| `agent_type` | string | Nei | Type / rolle for teamlederen |

## Hva som opprettes

- **Team-konfigurasjonsfil**: `~/.claude/teams/{team-name}/config.json` — lagrer medlemsliste og metadata
- **Oppgavelistemappe**: `~/.claude/tasks/{team-name}/` — delt oppgaveliste for alle teammedlemmer

Team har et 1:1-forhold til oppgavelister.

## Team-arbeidsflyt

1. **TeamCreate** — opprett teamet og dets oppgaveliste
2. **TaskCreate** — definer oppgaver for teamet
3. **Agent** (med `team_name` + `name`) — start teammedlemmer som slutter seg til teamet
4. **TaskUpdate** — tildel oppgaver til teammedlemmer via `owner`
5. Teammedlemmer arbeider med oppgaver og kommuniserer via **SendMessage**
6. Avslutt teammedlemmer når ferdig, deretter **TeamDelete** for opprydding

## Relaterte verktøy

| Verktøy | Formål |
|---------|--------|
| `TeamDelete` | Fjern team og oppgavemapper |
| `SendMessage` | Kommunikasjon mellom agenter i teamet |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | Administrer den delte oppgavelisten |
| `Agent` | Start teammedlemmer som slutter seg til teamet |
