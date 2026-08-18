# TaskUpdate

Ændrer en eksisterende opgave — dens status, indhold, ejerskab, metadata eller afhængighedskanter. Sådan skrider opgaver gennem deres livscyklus, og sådan overdrages arbejde mellem Claude Code, holdkammerater og underagenter.

## Hvornår skal den bruges

- Skift en opgave gennem statusworkflowet, mens du arbejder på den.
- Overtag en opgave ved at tildele dig selv (eller en anden agent) som `owner`.
- Finjustering af `subject` eller `description`, når du lærer mere om problemet.
- Registrering af nyopdagede afhængigheder med `addBlocks` / `addBlockedBy`.
- Vedhæft struktureret `metadata` som eksterne ticket-ID'er eller prioritetshints.

## Aktivering

- Tilgængelig som standard på de fleste modeller.
- Ikke tilgængelig på Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 og nyere familier (v2.1.233+), medmindre det tilvælges via `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` eller `--tools`.
- Hele opgavesystemet er deaktiveret, når `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parametre

- `taskId` (string, påkrævet): Den opgave, der skal ændres. Hent fra `TaskList` eller `TaskCreate`.
- `status` (string, valgfri): En af `pending`, `in_progress`, `completed`, `deleted`.
- `subject` (string, valgfri): Erstatningsimperativtitel.
- `description` (string, valgfri): Erstatningsdetaljeret beskrivelse.
- `activeForm` (string, valgfri): Erstatnings-nutid-continuous-spinner-tekst.
- `owner` (string, valgfri): Agent- eller holdkammerat-handle, der tager ansvar for opgaven.
- `metadata` (object, valgfri): Metadata-nøgler, der skal flettes ind i opgaven. Sæt en nøgle til `null` for at slette den.
- `addBlocks` (array af strings, valgfri): Opgave-ID'er, som denne opgave blokerer.
- `addBlockedBy` (array af strings, valgfri): Opgave-ID'er, der skal fuldføres, før denne.

## Statusworkflow

Livscyklussen er bevidst lineær: `pending` → `in_progress` → `completed`. `deleted` er terminal og bruges til at trække opgaver tilbage, der aldrig vil blive arbejdet på.

- Sæt `in_progress` i det øjeblik, du faktisk begynder arbejdet, ikke før. Kun én opgave ad gangen bør være `in_progress` for en given ejer.
- Sæt `completed`, kun når arbejdet er fuldt udført — accepteringskriterier opfyldt, tests bestået, output skrevet. Hvis en blokering viser sig, hold opgaven `in_progress` og tilføj en ny opgave, der beskriver, hvad der skal løses.
- Markér aldrig en opgave `completed`, når tests fejler, implementeringen er delvis, eller du støder på uløste fejl.
- Brug `deleted` for opgaver, der er annullerede eller dublerede; genbrug ikke en opgave til ikke-relateret arbejde.

## Eksempler

### Eksempel 1

Overtag en opgave og start den.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "in_progress",
  owner: "main-agent"
)
```

### Eksempel 2

Afslut arbejdet og registrér en opfølgende afhængighed.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "completed"
)

TaskUpdate(
  taskId: "t_01FOLLOWUP...",
  addBlockedBy: ["t_01HXYZ..."]
)
```

## Noter

- `metadata` fletter nøgle for nøgle; at sende `null` for en nøgle fjerner den. Kald `TaskGet` først, hvis du er usikker på det aktuelle indhold.
- `addBlocks` og `addBlockedBy` tilføjer kanter; de fjerner ikke eksisterende. Destruktiv redigering af grafen kræver et dedikeret workflow — rådfør dig med teamejeren, før du omskriver afhængigheder.
- Hold `activeForm` i synk, når du ændrer `subject`, så spinnertekst fortsat læses naturligt.
- Markér ikke en opgave `completed` for at tie den stille. Hvis brugeren annullerede arbejdet, brug `deleted` med en kort begrundelse i `description`.
- Læs en opgaves seneste tilstand med `TaskGet`, før du opdaterer — holdkammerater kan have ændret den mellem din sidste læsning og din skrivning.
