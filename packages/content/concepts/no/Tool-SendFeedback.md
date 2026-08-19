# SendFeedback

Sender strukturert tilbakemelding om Claude Code til Anthropic — feilrapporter, funksjonsforslag eller manglende kapabiliteter — uten å forlate sesjonen.

## Når skal den brukes

- Brukeren ber om å rapportere en feil eller sende tilbakemelding om selve Claude Code.
- Du traff en klar produktfeil (ødelagt kommando, feil oppførsel, krasj) verdt å rapportere.
- Brukeren beskriver en funksjon de skulle ønske fantes (en idé eller manglende kapabilitet).

## Parametere

- `type` (string, påkrevd): Én av `bug`, `idea`, `missing_capability`.
- `title` (string, påkrevd): Kort, spesifikk énlinjers oppsummering av problemet.
- `details` (string, påkrevd): Merkede kulepunkter, i rekkefølge: **What happened:** (observert vs. forventet, eksakt feiltekst hvis kort); **What the user said:** (sitert, eller "User didn't comment; observed by the model."); **Repro:** (minimale trinn); **Evidence:** (forespørsels-ID-er, tidsstempler, stier, versjoner — utelat hvis ingen); eventuelt et avsluttende **Cause:** kun hvis verifisert i sesjonen. Én til tre linjer per kulepunkt; ingen narrative avsnitt, ingen spekulasjon, ingen hemmeligheter. Etikettene skrives alltid på engelsk, ordrett.
- `area` (string, valgfri): Kort tag som navngir den delen av Claude Code dette gjelder (f.eks. "hooks config", "/help", "file editing"). La stå tom hvis uklart.
- `failure_mode` (string, valgfri): For rapporter om modellatferd, den nærmeste feilmodusen (f.eks. `instruction_following`, `repetition_and_looping`, `context_and_memory`, `stopping_short` eller `other`). Utelat kun når rapporten er en ren produkt-/verktøyfeil.
- `task_category` (string, valgfri): Hva sesjonen gjorde da problemet oppsto: `code_edit`, `debug`, `explain`, `plan`, `shell`, `search`, `review` eller `other`.

## Eksempler

### Eksempel 1: Rapporter en produktfeil

```
SendFeedback(
  type="bug",
  title="/export truncates the last message",
  details="**What happened:** exported transcript is missing the final assistant message.\n**What the user said:** \"the last reply never shows up in the file\".\n**Repro:** run /export after any multi-turn session.\n**Evidence:** v2.1.233, macOS.",
  area="/export",
  task_category="other"
)
```

## Notater

- Inkluder aldri hemmeligheter, tokens eller private brukerdata i `details`.
- Siter brukerens ord når de er tilgjengelige; ellers oppgi at modellen observerte problemet.
- Hold rapporten saklig — spekulasjon om rotårsak hører hjemme i `**Cause:**` kun når den er verifisert i sesjonen.
