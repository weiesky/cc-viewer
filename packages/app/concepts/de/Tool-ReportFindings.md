# ReportFindings

Berichten Sie Code-Review-Erkenntnisse als typisierte, strukturierte Liste, die die Host-Benutzeroberfläche nativ rendert — anstatt sie als Chat-Text auszudrucken.

## Wann verwenden

- Abschluss einer Code-Review, deren aktive Anweisungen ausdrücklich sagen, dass Sie Erkenntnisse mit diesem Tool melden sollen
- Neuberichterstattung nach Anwendung von Fixes, wenn die Review-Anweisung danach fragt (jede Erkenntnismeldung trägt dann ein `outcome`)
- **Nicht** für Ad-hoc-Meinungen, gewöhnliche Antworten oder Reviews, deren Anweisungen ein anderes Output-Format angeben — und niemals neben einer Text-Kopie derselben Erkenntnisse

## Parameter

- `findings` (Array, erforderlich, max. 32): Die überprüften Erkenntnisse, nach Schweregrad geordnet — ein leeres Array, wenn keine Erkenntnisse überprüft wurden. Jede Erkenntnis:
  - `file` (Zeichenkette, erforderlich): Repo-relativer Pfad.
  - `line` (Zahl, optional): 1-indizierte Ankerzeilennummer.
  - `summary` (Zeichenkette, erforderlich): Ein-Satz-Aussage des Defekts.
  - `failure_scenario` (Zeichenkette, erforderlich): Konkrete Eingaben/Zustand → falsche Ausgabe oder Absturz.
  - `category` (Zeichenkette, optional): Kurz kebab-case Slug, z. B. `correctness`, `simplification`, `efficiency`, `test-coverage`.
  - `verdict` (Zeichenkette, optional): `CONFIRMED` oder `PLAUSIBLE` — wird gesetzt, wenn ein Überprüfungspass ausgeführt wurde; fehlt bei nur-inline Reviews.
  - `outcome` (Zeichenkette, optional): NUR bei Neuberichterstattung nach Fixes — `fixed`, `skipped` oder `no_change_needed`.
- `level` (Zeichenkette, optional): Die Aufwandsstufe, auf der die Review ausgeführt wurde — `low`, `medium`, `high`, `xhigh` oder `max`.

## Hinweise

- **Rufen Sie sie einmal auf.** Ein einzelner Aufruf mit der vollständigen, überprüften, Schweregrad-geordneten Liste — nicht ein Aufruf pro Erkenntnis.
- **Leer ist ein gültiges Ergebnis.** Wenn keine Erkenntnis die Überprüfung überstand, melden Sie ein leeres Array statt mit schwachen Erkenntnissen zu füllen.
- **Nicht duplizieren im Text.** Wenn dieses Tool die Ergebnisse meldet, dürfen die Erkenntnisse nicht auch als Chat-Nachricht gedruckt werden.
- **`outcome` ist nur für Neuberichterstattung.** Beim ersten Bericht lassen Sie es ungesetzt; nach einem Anwendungspass, setzen Sie, was tatsächlich jedem Befund passiert ist.
