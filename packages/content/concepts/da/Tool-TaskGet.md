# TaskGet

Henter den fulde registrering for en enkelt opgave efter ID, inklusive dens beskrivelse, aktuelle status, ejer, metadata og afhængighedskanter. Brug den, når resuméet returneret af `TaskList` ikke er nok til at handle på opgaven.

## Hvornår skal den bruges

- Du har samlet en opgave op fra `TaskList` og har brug for den fulde beskrivelse, før du begynder arbejdet.
- Du er ved at markere en opgave `completed` og vil genkontrollere accepteringskriterierne.
- Du har brug for at inspicere, hvilke opgaver denne `blocks` eller er `blockedBy` for at bestemme det næste træk.
- Du undersøger historik — hvem ejer den, hvilken metadata blev vedhæftet, hvornår ændrede den tilstand.
- En holdkammerat eller tidligere session refererede til et opgave-ID, og du har brug for konteksten.

Foretræk `TaskList`, når du kun har brug for en overordnet scanning; reservér `TaskGet` til den specifikke post, du har til hensigt at læse nøje eller ændre.

## Aktivering

- Tilgængelig som standard på de fleste modeller.
- Ikke tilgængelig på Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 og nyere familier (v2.1.233+), medmindre det tilvælges via `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` eller `--tools`.
- Hele opgavesystemet er deaktiveret, når `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parametre

- `taskId` (string, påkrævet): Opgave-identifikatoren returneret af `TaskCreate` eller `TaskList`. ID'er er stabile i opgavens levetid.

## Eksempler

### Eksempel 1

Slå en opgave op, du netop så på listen.

```
TaskGet(taskId: "t_01HXYZ...")
```

Typiske svar-felter: `id`, `subject`, `description`, `activeForm`, `status`, `owner`, `blocks`, `blockedBy`, `metadata`, `createdAt`, `updatedAt`.

### Eksempel 2

Løs afhængigheder før start.

```
TaskGet(taskId: "t_01HXYZ...")
# Inspect blockedBy — if any referenced task is still pending
# or in_progress, work on the blocker first.
```

## Noter

- `TaskGet` er skrivebeskyttet og sikker at kalde gentagne gange; den ændrer ikke status eller ejerskab.
- Hvis `blockedBy` er ikke-tom og indeholder opgaver, der ikke er `completed`, så start ikke denne opgave — løs blokerne først (eller koordinér med deres ejer).
- `description`-feltet kan være langt. Læs det fuldt ud, før du handler; at skimme fører til overset accepteringskriterier.
- Et ukendt eller slettet `taskId` returnerer en fejl. Kør `TaskList` igen for at vælge et aktuelt ID.
- Hvis du er ved at redigere en opgave, kald `TaskGet` først for at undgå at overskrive felter, en holdkammerat netop har ændret.
