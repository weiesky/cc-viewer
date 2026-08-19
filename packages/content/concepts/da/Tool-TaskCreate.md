# TaskCreate

Opretter en ny opgave i det aktuelle teams opgaveliste (eller sessionens opgaveliste, når intet team er aktivt). Brug den til at fange arbejdselementer, der bør spores, delegeres eller gennemses senere.

## Hvornår skal den bruges

- Brugeren beskriver et flertrinsstykke arbejde, der drager fordel af eksplicit sporing.
- Du nedbryder en stor anmodning til mindre, separat færdiggørlige enheder.
- En opfølgning opdages midt i en opgave og bør ikke glemmes.
- Du har brug for en holdbar registrering af hensigt, før du overdrager arbejde til en holdkammerat eller underagent.
- Du opererer i plantilstand og vil have hvert plantrin repræsenteret som en konkret opgave.

Spring `TaskCreate` over for trivielle one-shot-handlinger, ren samtale eller alt, der kan gennemføres i to eller tre direkte værktøjskald.

## Aktivering

- Tilgængelig som standard på de fleste modeller.
- Ikke tilgængelig på Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 og nyere familier (v2.1.233+), medmindre det tilvælges via `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` eller `--tools`.
- Hele opgavesystemet er deaktiveret, når `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parametre

- `subject` (string, påkrævet): Kort imperativ titel, f.eks. `Fix login redirect on Safari`. Hold den under cirka firs tegn.
- `description` (string, påkrævet): Detaljeret kontekst — problemet, begrænsningerne, accepteringskriterier og alle filer eller links, en fremtidig læser vil have brug for. Skriv, som om en holdkammerat vil samle dette op helt koldt.
- `activeForm` (string, valgfri): Spinnertekst i nutid-continuous, der vises, mens opgaven er `in_progress`, f.eks. `Fixing login redirect on Safari`. Spejl `subject`, men i -ing-form.
- `metadata` (object, valgfri): Vilkårlige strukturerede data knyttet til opgaven. Almindelige anvendelser: labels, prioritetshints, eksterne ticket-ID'er eller agent-specifik konfiguration.

Nyoprettede opgaver starter altid med status `pending` og ingen ejer. Afhængigheder (`blocks`, `blockedBy`) sættes ikke ved oprettelse — anvend dem bagefter med `TaskUpdate`.

## Eksempler

### Eksempel 1

Fang en fejlrapport, brugeren netop indsendte.

```
TaskCreate(
  subject: "Repair broken PDF export on Windows",
  description: "Users on Windows 11 report the export button produces a 0-byte file. Reproduce with sample doc in test/fixtures/export/, then fix the code path in src/export/pdf.ts. Acceptance: export writes a valid PDF and the existing export test suite passes.",
  activeForm: "Repairing broken PDF export on Windows"
)
```

### Eksempel 2

Splittethed et epos op i sporede enheder ved starten af en session.

```
TaskCreate(
  subject: "Draft migration plan for auth service",
  description: "Produce a written plan covering rollout stages, rollback strategy, and monitoring. Output: docs/auth-migration.md.",
  activeForm: "Drafting migration plan for auth service",
  metadata: { "priority": "P1", "linearId": "AUTH-214" }
)
```

## Noter

- Skriv `subject` i bydeform og `activeForm` i nutid-continuous, så UI læses naturligt, når opgaven skifter til `in_progress`.
- Kald `TaskList` før oprettelse for at undgå dubletter — teamlisten deles med holdkammerater og underagenter.
- Inkludér ikke hemmeligheder eller legitimationsoplysninger i `description` eller `metadata`; opgaveregistreringer er synlige for alle med adgang til teamet.
- Efter oprettelse skal opgaven flyttes gennem sin livscyklus med `TaskUpdate`. Lad ikke arbejde stille dø i `in_progress`.
