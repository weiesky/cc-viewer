# TaskCreate

Oppretter en ny oppgave i gjeldende teams oppgaveliste (eller sesjonens oppgaveliste når ingen team er aktivt). Bruk det for å fange opp arbeidsposter som skal spores, delegeres eller vurderes på nytt senere.

## Når skal den brukes

- Brukeren beskriver et flertrinnsarbeid som tjener på eksplisitt sporing.
- Du deler en stor forespørsel inn i mindre, separat fullførbare enheter.
- En oppfølging oppdages midt i en oppgave og bør ikke glemmes.
- Du trenger en varig registrering av intensjon før du leverer arbeid til en lagkamerat eller underagent.
- Du opererer i planmodus og vil at hvert planlegg-trinn skal representeres som en konkret oppgave.

Hopp over `TaskCreate` for trivielle engangshandlinger, ren samtale eller noe som kan fullføres i to eller tre direkte verktøykall.

## Aktivering

- Tilgjengelig som standard på de fleste modeller.
- Ikke tilgjengelig på Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 og nyere familier (v2.1.233+) med mindre man melder seg på via `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` eller `--tools`.
- Hele oppgavesystemet er deaktivert når `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parametere

- `subject` (string, påkrevd): Kort imperativ tittel, f.eks. `Fix login redirect on Safari`. Hold den under omtrent åtti tegn.
- `description` (string, påkrevd): Detaljert kontekst — problemet, begrensningene, akseptkriteriene og eventuelle filer eller lenker en fremtidig leser trenger. Skriv som om en lagkamerat skal ta dette uten forkunnskap.
- `activeForm` (string, valgfri): Spinner-tekst i presens partisipp vist mens oppgaven er `in_progress`, f.eks. `Fixing login redirect on Safari`. Speil `subject` men i -ing-form.
- `metadata` (objekt, valgfri): Vilkårlige strukturerte data knyttet til oppgaven. Vanlige bruksområder: etiketter, prioritetshint, eksterne ticket-ID-er eller agent-spesifikk konfigurasjon.

Nyopprettede oppgaver starter alltid med status `pending` og ingen eier. Avhengigheter (`blocks`, `blockedBy`) settes ikke ved opprettelse — anvend dem etterpå med `TaskUpdate`.

## Eksempler

### Eksempel 1

Fang opp en feilrapport brukeren nettopp leverte.

```
TaskCreate(
  subject: "Repair broken PDF export on Windows",
  description: "Users on Windows 11 report the export button produces a 0-byte file. Reproduce with sample doc in test/fixtures/export/, then fix the code path in src/export/pdf.ts. Acceptance: export writes a valid PDF and the existing export test suite passes.",
  activeForm: "Repairing broken PDF export on Windows"
)
```

### Eksempel 2

Del en epic inn i sporede enheter ved starten av en sesjon.

```
TaskCreate(
  subject: "Draft migration plan for auth service",
  description: "Produce a written plan covering rollout stages, rollback strategy, and monitoring. Output: docs/auth-migration.md.",
  activeForm: "Drafting migration plan for auth service",
  metadata: { "priority": "P1", "linearId": "AUTH-214" }
)
```

## Notater

- Skriv `subject` i imperativ og `activeForm` i presens partisipp slik at UI-et leses naturlig når oppgaven overgår til `in_progress`.
- Kall `TaskList` før opprettelse for å unngå duplikater — teamlisten er delt med lagkamerater og underagenter.
- Ikke inkluder hemmeligheter eller påloggingsinformasjon i `description` eller `metadata`; oppgaveposter er synlige for alle med tilgang til teamet.
- Etter opprettelse, flytt oppgaven gjennom livssyklusen med `TaskUpdate`. Ikke la arbeid forlates i stillhet i `in_progress`.
