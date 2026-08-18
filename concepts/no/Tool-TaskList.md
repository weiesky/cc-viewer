# TaskList

Returnerer hver oppgave i gjeldende team (eller sesjon) i oppsummert form. Bruk det for å kartlegge utestående arbeid, bestemme hva du skal plukke opp neste, og unngå å opprette duplikater.

## Når skal den brukes

- Ved starten av en sesjon for å se hva som allerede er sporet.
- Før du kaller `TaskCreate`, for å bekrefte at arbeidet ikke allerede er fanget.
- Når du bestemmer hvilken oppgave du skal ta som lagkamerat eller underagent.
- For å verifisere avhengighetsrelasjoner på tvers av teamet med et blikk.
- Periodisk under lange sesjoner for å resynkronisere med lagkamerater som kan ha tatt, fullført eller lagt til oppgaver.

`TaskList` er skrivebeskyttet og billig; kall den fritt når du trenger en oversikt.

## Aktivering

- Tilgjengelig som standard på de fleste modeller.
- Ikke tilgjengelig på Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 og nyere familier (v2.1.233+) med mindre man melder seg på via `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` eller `--tools`.
- Hele oppgavesystemet er deaktivert når `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parametere

`TaskList` tar ingen parametere. Den returnerer alltid hele oppgavesettet for den aktive konteksten.

## Responsform

Hver oppgave i listen er et sammendrag, ikke hele posten. Forvent omtrent:

- `id` — stabil identifikator for bruk med `TaskGet` / `TaskUpdate`.
- `subject` — kort imperativ tittel.
- `status` — en av `pending`, `in_progress`, `completed`, `deleted`.
- `owner` — agent- eller lagkamerathandle, eller tom når uclaimet.
- `blockedBy` — array av oppgave-ID-er som må fullføres først.

For den fulle beskrivelsen, akseptkriteriene eller metadataen for en bestemt oppgave, følg opp med `TaskGet`.

## Eksempler

### Eksempel 1

Rask statussjekk.

```
TaskList()
```

Skann utdata for alt `in_progress` uten en `owner` (foreldet arbeid) og alt `pending` med tom `blockedBy` (klar til å plukke opp).

### Eksempel 2

Lagkamerat som plukker neste oppgave.

```
TaskList()
# Filter to: status == pending AND blockedBy is empty AND owner is empty.
# Among those, prefer the lower ID (tasks are typically numbered in
# creation order, so lower IDs are older and usually higher priority).
TaskGet(taskId: "<chosen id>")
TaskUpdate(taskId: "<chosen id>", status: "in_progress", owner: "<your handle>")
```

## Notater

- Lagkamerat-heuristikk: når flere `pending`-oppgaver er ublokkerte og uten eier, velg den laveste ID-en. Dette holder arbeidet FIFO og unngår at to agenter tar samme høy-profil-oppgave.
- Respekter `blockedBy`: ikke start en oppgave der blokkerne fortsatt er `pending` eller `in_progress`. Arbeid på blokkeren først eller koordiner med eieren.
- `TaskList` er den eneste oppdagelsesmekanismen for oppgaver. Det er ingen søk; hvis listen er lang, skann strukturelt (etter status, deretter etter eier).
- Slettede oppgaver kan fortsatt vises i listen med status `deleted` for sporbarhet. Ignorer dem for planleggingsformål.
- Listen reflekterer den levende tilstanden til teamet, så lagkamerater kan legge til eller ta oppgaver mellom kall. Kall listen på nytt før du tar hvis tid har gått.
