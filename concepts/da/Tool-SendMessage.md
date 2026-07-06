# SendMessage

## Definition

Sender beskeder mellem agenter inden for et team. Bruges til direkte kommunikation, broadcasting og protokolbeskeder (shutdown-anmodninger/-svar, plangodkendelse).

## Parametre

| Parameter | Type | Påkrævet | Beskrivelse |
|-----------|------|----------|-------------|
| `to` | string | Ja | Modtager: teammedlemmets navn, eller `"*"` for broadcast til alle |
| `message` | string / object | Ja | Ren tekstbesked eller struktureret protokolobjekt |
| `summary` | string | Nej | En forhåndsvisning på 5-10 ord vist i brugerfladen |

## Beskedtyper

### Ren tekst
Direkte beskeder mellem teammedlemmer til koordinering, statusopdateringer og opgavediskussioner.

### Shutdown-anmodning
Beder et teammedlem om at lukke ned pænt: `{ type: "shutdown_request", reason: "..." }`

### Shutdown-svar
Teammedlem godkender eller afviser shutdown: `{ type: "shutdown_response", approve: true/false }`

### Plangodkendelsessvar
Godkender eller afviser et teammedlems plan: `{ type: "plan_approval_response", approve: true/false }`

## Broadcast vs. direkte

- **Direkte** (`to: "teammedlem-navn"`): Send til et bestemt teammedlem — foretrukket til de fleste kommunikationer
- **Broadcast** (`to: "*"`): Send til alle teammedlemmer — brug sparsomt, kun til kritiske teamdækkende meddelelser

## Relaterede værktøjer

| Værktøj | Formål |
|---------|--------|
| `TeamCreate` | Opret et nyt team |
| `TeamDelete` | Fjern team når det er færdigt |
| `Agent` | Start teammedlemmer der tilslutter sig teamet |
| `TaskCreate` / `TaskUpdate` / `TaskList` | Administrer den delte opgaveliste |
