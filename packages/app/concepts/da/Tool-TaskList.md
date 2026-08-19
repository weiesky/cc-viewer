# TaskList

Returnerer hver opgave i det aktuelle team (eller session) i opsummeret form. Brug den til at gennemgå udestående arbejde, beslutte hvad du skal samle op næste, og undgå at oprette dubletter.

## Hvornår skal den bruges

- Ved starten af en session for at se, hvad der allerede spores.
- Før kald af `TaskCreate` for at bekræfte, at arbejdet ikke allerede er fanget.
- Når du beslutter, hvilken opgave du skal overtage næste som holdkammerat eller underagent.
- For at verificere afhængighedsforhold på tværs af teamet med et hurtigt blik.
- Periodisk under lange sessioner for at genresynkronisere med holdkammerater, der kan have overtaget, fuldført eller tilføjet opgaver.

`TaskList` er skrivebeskyttet og billig; kald den frit, når du har brug for et overblik.

## Aktivering

- Tilgængelig som standard på de fleste modeller.
- Ikke tilgængelig på Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 og nyere familier (v2.1.233+), medmindre det tilvælges via `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` eller `--tools`.
- Hele opgavesystemet er deaktiveret, når `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parametre

`TaskList` tager ingen parametre. Den returnerer altid det fulde opgavesæt for den aktive kontekst.

## Svarform

Hver opgave i listen er et resumé, ikke den fulde registrering. Forvent cirka:

- `id` — stabil identifikator til brug med `TaskGet` / `TaskUpdate`.
- `subject` — kort imperativ titel.
- `status` — en af `pending`, `in_progress`, `completed`, `deleted`.
- `owner` — agent- eller holdkammerat-handle, eller tom, når uoverdraget.
- `blockedBy` — array af opgave-ID'er, der skal fuldføres først.

For den fulde beskrivelse, accepteringskriterier eller metadata for en specifik opgave, følg op med `TaskGet`.

## Eksempler

### Eksempel 1

Hurtig statuskontrol.

```
TaskList()
```

Scan outputtet for alt, der er `in_progress` uden en `owner` (forældet arbejde), og alt `pending` med en tom `blockedBy` (klar til at samle op).

### Eksempel 2

Holdkammerat, der vælger den næste opgave.

```
TaskList()
# Filter to: status == pending AND blockedBy is empty AND owner is empty.
# Among those, prefer the lower ID (tasks are typically numbered in
# creation order, so lower IDs are older and usually higher priority).
TaskGet(taskId: "<chosen id>")
TaskUpdate(taskId: "<chosen id>", status: "in_progress", owner: "<your handle>")
```

## Noter

- Holdkammerat-heuristik: når flere `pending`-opgaver er ublokerede og uoverdragne, vælg det laveste ID. Dette holder arbejdet FIFO og undgår, at to agenter griber den samme højprofilerede opgave.
- Respektér `blockedBy`: start ikke en opgave, hvis blokere stadig er `pending` eller `in_progress`. Arbejd på blokeren først, eller koordinér med dens ejer.
- `TaskList` er den eneste opdagelsesmekanisme for opgaver. Der er ingen søgning; hvis listen er lang, scan strukturelt (efter status, derefter efter ejer).
- Slettede opgaver kan stadig fremgå af listen med status `deleted` for sporbarhed. Ignorer dem til planlægningsformål.
- Listen afspejler teamets live-tilstand, så holdkammerater kan tilføje eller overtage opgaver mellem kald. Gen-list før overtagelse, hvis tid er gået.
