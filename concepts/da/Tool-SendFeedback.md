# SendFeedback

Sender struktureret feedback om Claude Code til Anthropic — fejlrapporter, feature-idéer eller manglende kapaciteter — uden at forlade sessionen.

## Hvornår skal den bruges

- Brugeren beder om at rapportere en fejl eller sende feedback om selve Claude Code.
- Du støder på en klar produktdefekt (ødelagt kommando, forkert opførsel, crash), der er værd at rapportere.
- Brugeren beskriver en feature, de ønsker fandtes (en idé eller en manglende kapacitet).

## Parametre

- `type` (string, påkrævet): Én af `bug`, `idea`, `missing_capability`.
- `title` (string, påkrævet): Kort, specifik one-line-opsummering af problemet.
- `details` (string, påkrævet): Mærkede bulletpunkter, i rækkefølge: **What happened:** (observeret vs. forventet, eksakt fejltekst hvis kort); **What the user said:** (citeret, eller "User didn't comment; observed by the model."); **Repro:** (minimale trin); **Evidence:** (request-ID'er, tidsstempler, stier, versioner — udelad hvis ingen); eventuelt en afsluttende **Cause:** kun hvis verificeret i sessionen. Én til tre linjer pr. punkt; ingen fortællende afsnit, ingen spekulation, ingen hemmeligheder.
- `area` (string, valgfri): Kort tag, der navngiver den del af Claude Code, det handler om (f.eks. "hooks config", "/help", "file editing"). Lad være tom, hvis uklart.
- `failure_mode` (string, valgfri): For modeladfærdsrapporter den nærmeste fejltilstand (f.eks. `instruction_following`, `repetition_and_looping`, `context_and_memory`, `stopping_short` eller `other`). Udelad kun, når rapporten er en ren produkt-/værktøjsfejl.
- `task_category` (string, valgfri): Hvad sessionen lavede, da problemet opstod: `code_edit`, `debug`, `explain`, `plan`, `shell`, `search`, `review` eller `other`.

## Eksempler

### Eksempel 1: Rapporter en produktfejl

```
SendFeedback(
  type="bug",
  title="/export truncates the last message",
  details="**What happened:** exported transcript is missing the final assistant message.\n**What the user said:** \"the last reply never shows up in the file\".\n**Repro:** run /export after any multi-turn session.\n**Evidence:** v2.1.233, macOS.",
  area="/export",
  task_category="other"
)
```

## Noter

- Medtag aldrig hemmeligheder, tokens eller private brugerdata i `details`.
- Citér brugerens ord, når de er tilgængelige; angiv ellers, at modellen observerede problemet.
- Hold rapporten faktuel — spekulation om rodårsag hører kun hjemme i `**Cause:**`, når den er verificeret i sessionen.
