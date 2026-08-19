# SendMessage

Leverer en melding fra ett teammedlem til et annet i et aktivt team, eller kringkaster til hver lagkamerat samtidig. Dette er den eneste kanalen lagkamerater kan høre — alt som skrives til normal tekstutdata er usynlig for dem.

## Når skal den brukes

- Tildele en oppgave eller overlevere et delproblem til en navngitt lagkamerat under teamsamarbeid.
- Be om status, mellomliggende funn eller en kodegjennomgang fra en annen agent.
- Kringkaste en beslutning, delt begrensning eller nedstengningsmelding til hele teamet via `*`.
- Svare på en protokollforespørsel som en shutdown-forespørsel eller en plangodkjenningsforespørsel fra teamlederen.
- Lukke sløyfen på slutten av en delegert oppgave slik at lederen kan markere punktet som fullført.

## Aktivering

- Gated av de samme kryss-sesjonsmelding-betingelsene som `ListAgents` (server-side feature-flags, av som standard).
- Lagkamerater krever i tillegg at eksperimentelle agent-team er aktivert.

## Parametere

- `to` (string, påkrevd): Målleagkameratens `name` som registrert i teamet, eller `*` for å kringkaste til alle lagkamerater samtidig.
- `message` (string eller objekt, påkrevd): Ren tekst for normal kommunikasjon, eller et strukturert objekt for protokollsvar som `shutdown_response` og `plan_approval_response`.
- `summary` (string, valgfri): En 5–10-ords forhåndsvisning vist i teamaktivitetsloggen for tekstmeldinger. Påkrevd for lange strengmeldinger; ignoreres når `message` er et protokollobjekt.

## Eksempler

### Eksempel 1: Direkte oppgaveoverlevering

```
SendMessage(
  to="db-lead",
  message="Please audit prisma/schema.prisma and list any model missing createdAt/updatedAt timestamps. Reply when done.",
  summary="Audit schema for missing timestamps"
)
```

### Eksempel 2: Kringkast en felles begrensning

```
SendMessage(
  to="*",
  message="Reminder: do not touch files under legacy/ — that subtree is frozen until the migration PR lands.",
  summary="Freeze legacy/ during migration"
)
```

### Eksempel 3: Protokollsvar

Svar på en shutdown-forespørsel fra lederen med en strukturert melding:

```
SendMessage(
  to="leader",
  message={ "type": "shutdown_response", "ready": true, "final_report": "All assigned diff chunks committed on branch refactor-crew/db-lead." }
)
```

### Eksempel 4: Plangodkjenningssvar

```
SendMessage(
  to="leader",
  message={ "type": "plan_approval_response", "approved": true, "notes": "LGTM, but please split step 4 into migration + backfill." }
)
```

## Notater

- Din vanlige assistenttekst-utdata overføres IKKE til lagkamerater. Hvis du vil at en annen agent skal se noe, må det gå gjennom `SendMessage`. Dette er den vanligste feilen i team-arbeidsflyter.
- Kringkasting (`to: "*"`) er kostbart — det vekker hver lagkamerat og bruker deres kontekst. Reserver det for kunngjøringer som faktisk påvirker alle. Foretrekk målrettede sendinger.
- Hold meldinger konsise og handlingsrettede. Inkluder filbanene, begrensningene og forventet svarformat mottakeren trenger; husk at de ikke har noe delt minne med deg.
- Protokollmeldingsobjekter (`shutdown_response`, `plan_approval_response`) har faste former. Ikke bland protokollfelter inn i tekstmeldinger eller omvendt.
- Meldinger er asynkrone. Mottakeren får din på sin neste tur; ikke anta at de har lest eller handlet på den før de svarer.
- En godt skrevet `summary` gjør teamaktivitetsloggen lettlest for lederen — behandle den som en commit-overskriftslinje.
