# TaskGet

Henter hele posten for en enkelt oppgave med ID, inkludert beskrivelse, gjeldende status, eier, metadata og avhengighetskanter. Bruk det når sammendraget returnert av `TaskList` ikke er nok til å handle på oppgaven.

## Når skal den brukes

- Du plukket opp en oppgave fra `TaskList` og trenger den fulle beskrivelsen før du begynner arbeidet.
- Du er i ferd med å markere en oppgave `completed` og vil dobbeltsjekke akseptkriteriene.
- Du må inspisere hvilke oppgaver denne `blocks` eller er `blockedBy` for å avgjøre neste trekk.
- Du undersøker historikk — hvem eier den, hvilken metadata ble knyttet, når endret den tilstand.
- En lagkamerat eller tidligere sesjon refererte til en oppgave-ID og du trenger konteksten.

Foretrekk `TaskList` når du bare trenger en oversikt på høyt nivå; reserver `TaskGet` for den spesifikke posten du har tenkt å lese nøye eller endre.

## Aktivering

- Tilgjengelig som standard på de fleste modeller.
- Ikke tilgjengelig på Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 og nyere familier (v2.1.233+) med mindre man melder seg på via `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` eller `--tools`.
- Hele oppgavesystemet er deaktivert når `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parametere

- `taskId` (string, påkrevd): Oppgaveidentifikatoren returnert av `TaskCreate` eller `TaskList`. ID-er er stabile gjennom oppgavens levetid.

## Eksempler

### Eksempel 1

Slå opp en oppgave du nettopp så i listen.

```
TaskGet(taskId: "t_01HXYZ...")
```

Typiske svarfelter: `id`, `subject`, `description`, `activeForm`, `status`, `owner`, `blocks`, `blockedBy`, `metadata`, `createdAt`, `updatedAt`.

### Eksempel 2

Løs avhengigheter før du starter.

```
TaskGet(taskId: "t_01HXYZ...")
# Inspect blockedBy — if any referenced task is still pending
# or in_progress, work on the blocker first.
```

## Notater

- `TaskGet` er skrivebeskyttet og trygt å kalle gjentatte ganger; det endrer ikke status eller eierskap.
- Hvis `blockedBy` er ikke-tom og inneholder oppgaver som ikke er `completed`, ikke start denne oppgaven — løs blokkerne først (eller koordiner med eieren deres).
- `description`-feltet kan være langt. Les det fullt ut før du handler; å skumlese fører til missede akseptkriterier.
- En ukjent eller slettet `taskId` returnerer en feil. Kjør `TaskList` på nytt for å plukke en gjeldende ID.
- Hvis du er i ferd med å redigere en oppgave, kall `TaskGet` først for å unngå å overskrive felter en lagkamerat nettopp endret.
