# SendMessage

Leverer en besked fra ét teammedlem til et andet inden for et aktivt team, eller broadcaster til alle holdkammerater på én gang. Dette er den eneste kanal, holdkammerater kan høre — alt, der skrives til normalt tekstoutput, er usynligt for dem.

## Hvornår skal den bruges

- Tildele en opgave eller overdrage et delproblem til en navngivet holdkammerat under teamsamarbejde.
- Anmode om status, mellemresultater eller en kodegennemgang fra en anden agent.
- Broadcaste en beslutning, en delt begrænsning eller en nedlukningsbesked til hele teamet via `*`.
- Svare på en protokolforespørgsel som en nedlukningsanmodning eller en plangodkendelsesanmodning fra teamlederen.
- Afslutte cirklen ved slutningen af en delegeret opgave, så lederen kan markere posten som fuldført.

## Aktivering

- Gated af de samme betingelser for beskeder på tværs af sessioner som `ListAgents` (server-side feature-flags, slået fra som standard).
- Holdkammerater kræver desuden, at eksperimentelle agentteams er aktiveret.

## Parametre

- `to` (string, påkrævet): Målholdkammeratens `name`, som registreret i teamet, eller `*` for at broadcaste til alle holdkammerater på én gang.
- `message` (string eller object, påkrævet): Almindelig tekst til normal kommunikation, eller et struktureret objekt til protokolsvar som `shutdown_response` og `plan_approval_response`.
- `summary` (string, valgfri): En forhåndsvisning på 5-10 ord, der vises i team-aktivitetsloggen for almindelige tekstbeskeder. Påkrævet for lange strengbeskeder; ignoreres, når `message` er et protokolobjekt.

## Eksempler

### Eksempel 1: Direkte opgaveoverdragelse

```
SendMessage(
  to="db-lead",
  message="Please audit prisma/schema.prisma and list any model missing createdAt/updatedAt timestamps. Reply when done.",
  summary="Audit schema for missing timestamps"
)
```

### Eksempel 2: Broadcast en delt begrænsning

```
SendMessage(
  to="*",
  message="Reminder: do not touch files under legacy/ — that subtree is frozen until the migration PR lands.",
  summary="Freeze legacy/ during migration"
)
```

### Eksempel 3: Protokolsvar

Svar på en nedlukningsanmodning fra lederen ved hjælp af en struktureret besked:

```
SendMessage(
  to="leader",
  message={ "type": "shutdown_response", "ready": true, "final_report": "All assigned diff chunks committed on branch refactor-crew/db-lead." }
)
```

### Eksempel 4: Plangodkendelsessvar

```
SendMessage(
  to="leader",
  message={ "type": "plan_approval_response", "approved": true, "notes": "LGTM, but please split step 4 into migration + backfill." }
)
```

## Noter

- Dit almindelige assistenttekstoutput sendes IKKE til holdkammerater. Hvis du vil have en anden agent til at se noget, skal det gå gennem `SendMessage`. Dette er den mest almindelige fejl i team-workflows.
- Broadcast (`to: "*"`) er dyrt — det vækker hver holdkammerat og forbruger deres kontekst. Reservér det til meddelelser, der reelt påvirker alle. Foretræk målrettede forsendelser.
- Hold beskeder kortfattede og handlingsorienterede. Medtag filstier, begrænsninger og det forventede svarformat, modtageren har brug for; husk, de ikke deler hukommelse med dig.
- Protokolbeskedobjekter (`shutdown_response`, `plan_approval_response`) har faste former. Bland ikke protokolfelter ind i almindelige tekstbeskeder eller omvendt.
- Beskeder er asynkrone. Modtageren modtager din på sin næste runde; antag ikke, at de har læst eller handlet på den, før de svarer.
- En velskrevet `summary` gør team-aktivitetsloggen scanbar for lederen — behandl den som en commit-emnelinje.
