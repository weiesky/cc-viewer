# Workflow

Führt ein Skript aus, das viele Subagenten deterministisch orchestriert — Fan-out, Pipelines, Schleifen und Verifizierung — für Arbeit, die zu breit, zu unsicher oder zu groß für einen einzelnen Kontext ist.

## Wann zu verwenden

- Eine große Aufgabe zerlegen und parallel über viele Agenten hinweg abdecken
- Ergebnisse durch unabhängige oder adversariale Verifizierung gegenprüfen, bevor man sich auf sie verlässt
- Einen Umfang bewältigen, den ein einzelner Kontext nicht fassen kann: Migrationen, Audits, breite dateiübergreifende Durchläufe

## Funktionsweise

- Läuft im Hintergrund; du wirst benachrichtigt, wenn es fertig ist. Verfolge den Live-Fortschritt mit `/workflows`.
- Das Skript koordiniert Agenten mit `agent()`, `parallel()`, `pipeline()` und `phase()`.
- `pipeline()` streamt jedes Element ohne Barriere durch die Stufen (Standard); `parallel()` ist eine Barriere, die auf alle Ergebnisse wartet.
- Mit einem `schema` gibt jeder `agent()` validierte strukturierte Daten statt Freitext zurück.

## Hinweise

- Läuft nur, wenn sich der Benutzer ausdrücklich für eine Multi-Agenten-Orchestrierung entscheidet; es kann viele Agenten erzeugen und erhebliche Token verbrauchen.
- Die Nebenläufigkeit ist pro Workflow gedeckelt; überschüssige Agenten werden in eine Warteschlange gestellt und laufen, sobald Plätze frei werden.
- Für einen einzelnen Subagenten verwende stattdessen das Werkzeug `Agent` — reserviere Workflow für echtes Fan-out.

## Verwandte Konzepte

- Baut auf dem Werkzeug `Agent` auf und führt viele Agenten unter deterministischem Kontrollfluss aus.
