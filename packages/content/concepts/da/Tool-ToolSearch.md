# ToolSearch

Henter on demand de fuldstændige schema-definitioner for "udskudte værktøjer", så de bliver kaldbare. Når mange værktøjer er tilgængelige, indlæses nogle ikke på forhånd — de optræder kun ved navn inde i `<system-reminder>`-beskeder. Indtil dets schema er hentet, kendes kun navnet, og der er ingen parameterdefinition, så værktøjet kan ikke invokeres. `ToolSearch` modtager en forespørgsel, matcher den mod listen over udskudte værktøjer og returnerer de matchede værktøjers fuldstændige JSONSchema-definitioner inde i en `<functions>`-blok. Så snart et værktøjs schema optræder i resultatet, kan det kaldes præcis som ethvert værktøj defineret i toppen af prompten.

## Hvornår skal den bruges

- Du har brug for et udskudt værktøj — dets navn optræder i en `<system-reminder>`, men der er ingen parameterdefinition for det i værktøjslisten på øverste niveau.
- Du vil bruge en MCP-servers værktøjer (f.eks. Slack, Gmail, computer-use), der indlæses on demand.
- Du er ikke sikker på det eksakte værktøjsnavn for en kapacitet og vil få kandidater frem efter nøgleord i ét hug.

Hvis et værktøjs schema allerede er i konteksten, så søg ikke igen — kald det blot.

## Aktivering

- Slået til som standard.
- Slået fra, når `ANTHROPIC_BASE_URL` peger på et ikke-Anthropic-endpoint (medmindre `ENABLE_TOOL_SEARCH` er sat), når `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` er sat, når modellen mangler værktøjsreference-understøttelse (Vertex AI-modeller før Claude 4.5), eller når det nægtes via `"deny": ["ToolSearch"]`.

## Parametre

- `query` (string, påkrævet): Forespørgslen, der bruges til at lokalisere udskudte værktøjer. Tre former understøttes:
  - `select:Read,Edit,Grep` — henter disse eksakte værktøjer ved navn.
  - `notebook jupyter` — nøgleordssøgning, der returnerer op til `max_results` bedste match.
  - `+slack send` — kræver, at `slack` optræder i værktøjsnavnet, og rangerer derefter efter de resterende termer.
- `max_results` (number, valgfri): Maksimalt antal resultater, der returneres. Standard er 5.

## Eksempler

### Eksempel 1: Hent ved eksakt navn

```
ToolSearch(query="select:WebFetch,WebSearch", max_results=5)
```

### Eksempel 2: Nøgleordssøgning

```
ToolSearch(query="notebook jupyter", max_results=5)
```

### Eksempel 3: Indlæs et helt MCP-værktøjssæt på én gang

Når du masseindlæser alle værktøjer fra en MCP-server (f.eks. computer-use), så brug en enkelt nøgleordssøgning i stedet for at vælge hvert enkelt — servernavnet som delstreng matcher alle værktøjer under den server:

```
ToolSearch(query="computer-use", max_results=30)
```

## Noter

- Før du invokerer et udskudt værktøj, skal du først hente dets schema med `ToolSearch` — at kalde det direkte fejler, fordi parameterdefinitionen mangler.
- Når du masseindlæser et helt værktøjssæt (f.eks. alle en MCP-servers værktøjer), så foretræk én nøgleordssøgning frem for mange `select:`-kald for at skære ned på frem og tilbage.
- Så snart et schema er hentet, opfører værktøjet sig præcis som ethvert normalt værktøj; søg ikke efter det samme værktøj igen.
- Resultaterne kommer tilbage som en `<functions>`-blok, hvert værktøj en enkelt `<function>{...}</function>`-linje — den samme kodning som værktøjslisten på øverste niveau.
