# SendFeedback

Sendet strukturiertes Feedback über Claude Code an Anthropic – Fehlerberichte, Funktionsideen oder fehlende Fähigkeiten –, ohne die Sitzung zu verlassen.

## Wann verwenden

- Der Benutzer bittet darum, einen Fehler zu melden oder Feedback zu Claude Code selbst zu senden.
- Sie stoßen auf einen eindeutigen Produktfehler (kaputter Befehl, falsches Verhalten, Absturz), der meldenswert ist.
- Der Benutzer beschreibt eine Funktion, die er sich wünscht (eine Idee oder fehlende Fähigkeit).

## Parameter

- `type` (string, erforderlich): Einer von `bug`, `idea`, `missing_capability`.
- `title` (string, erforderlich): Kurze, präzise einzeilige Zusammenfassung des Problems.
- `details` (string, erforderlich): Beschriftete Aufzählungspunkte, in dieser Reihenfolge: **What happened:** (beobachtet vs. erwartet, exakter Fehlertext, falls kurz); **What the user said:** (zitiert, oder "User didn't comment; observed by the model."); **Repro:** (minimale Schritte); **Evidence:** (Request-IDs, Zeitstempel, Pfade, Versionen – weglassen, falls keine); optional ein abschließendes **Cause:** nur wenn in der Sitzung verifiziert. Ein bis drei Zeilen pro Punkt; keine erzählenden Absätze, keine Spekulation, keine Geheimnisse.
- `area` (string, optional): Kurzes Tag, das den betroffenen Teil von Claude Code benennt (z. B. "hooks config", "/help", "file editing"). Leer lassen, wenn unklar.
- `failure_mode` (string, optional): Für Berichte über Modellverhalten der nächstliegende Fehlermodus (z. B. `instruction_following`, `repetition_and_looping`, `context_and_memory`, `stopping_short` oder `other`). Nur weglassen, wenn der Bericht ein reiner Produkt-/Tool-Fehler ist.
- `task_category` (string, optional): Was die Sitzung beim Auftreten des Problems gerade tat: `code_edit`, `debug`, `explain`, `plan`, `shell`, `search`, `review` oder `other`.

## Beispiele

### Beispiel 1: Einen Produktfehler melden

```
SendFeedback(
  type="bug",
  title="/export truncates the last message",
  details="**What happened:** exported transcript is missing the final assistant message.\n**What the user said:** \"the last reply never shows up in the file\".\n**Repro:** run /export after any multi-turn session.\n**Evidence:** v2.1.233, macOS.",
  area="/export",
  task_category="other"
)
```

## Hinweise

- Nehmen Sie niemals Geheimnisse, Tokens oder private Benutzerdaten in `details` auf.
- Zitieren Sie die Worte des Benutzers, wenn verfügbar; andernfalls geben Sie an, dass das Modell das Problem beobachtet hat.
- Halten Sie den Bericht sachlich – Spekulation über die Ursache gehört nur dann in `**Cause:**`, wenn sie in der Sitzung verifiziert wurde.
