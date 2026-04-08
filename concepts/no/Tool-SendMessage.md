# SendMessage

## Definisjon

Sender meldinger mellom agenter i et team. Brukes til direkte kommunikasjon, kringkasting og protokollmeldinger (shutdown-forespørsler/-svar, plangodkjenning).

## Parametere

| Parameter | Type | Påkrevd | Beskrivelse |
|-----------|------|---------|-------------|
| `to` | string | Ja | Mottaker: teammedlemmets navn, eller `"*"` for kringkasting til alle |
| `message` | string / object | Ja | Ren tekstmelding eller strukturert protokollobjekt |
| `summary` | string | Nei | En forhåndsvisning på 5-10 ord vist i brukergrensesnittet |

## Meldingstyper

### Ren tekst
Direktemeldinger mellom teammedlemmer for koordinering, statusoppdateringer og oppgavediskusjoner.

### Shutdown-forespørsel
Ber et teammedlem om å avslutte på en ryddig måte: `{ type: "shutdown_request", reason: "..." }`

### Shutdown-svar
Teammedlem godkjenner eller avslår shutdown: `{ type: "shutdown_response", approve: true/false }`

### Plangodkjenningssvar
Godkjenner eller avslår et teammedlems plan: `{ type: "plan_approval_response", approve: true/false }`

## Kringkasting vs. direkte

- **Direkte** (`to: "teammedlem-navn"`): Send til et bestemt teammedlem — foretrukket for de fleste kommunikasjoner
- **Kringkasting** (`to: "*"`): Send til alle teammedlemmer — bruk sparsomt, kun for kritiske teamomfattende kunngjøringer

## Relaterte verktøy

| Verktøy | Formål |
|---------|--------|
| `TeamCreate` | Opprett et nytt team |
| `TeamDelete` | Fjern team når ferdig |
| `Agent` | Start teammedlemmer som slutter seg til teamet |
| `TaskCreate` / `TaskUpdate` / `TaskList` | Administrer den delte oppgavelisten |
