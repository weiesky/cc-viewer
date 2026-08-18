# ScheduleWakeup

Plant, wann die Arbeit im `/loop`-Dynamikmodus wiederaufgenommen werden soll. Das Tool ermöglicht es Claude, das Iterationstempo einer Aufgabe selbstständig zu steuern, für ein gewähltes Intervall zu schlafen und dann mit demselben Loop-Prompt erneut zu feuern.

## Wann verwenden

- Beim eigenständigen Steuern des Tempos einer `/loop`-Dynamikaufgabe, bei der das Iterationsintervall vom Arbeitsstatus und nicht von einer festen Uhr abhängt
- Beim Warten auf den Abschluss eines langen Builds, Deployments oder Testlaufs, bevor Ergebnisse geprüft werden
- Beim Einfügen von Leerlauf-Ticks zwischen Iterationen, wenn gerade kein bestimmtes Signal zu beobachten ist
- Beim Ausführen einer autonomen Schleife ohne Benutzer-Prompt — den literalen Sentinel `<<autonomous-loop-dynamic>>` als `prompt` übergeben
- Beim Abfragen eines Prozesses, dessen Zustand sich bald ändern wird (kurze Verzögerung zum Warmhalten des Caches)

## Aktivierung

- Nicht verfügbar auf Amazon Bedrock, Claude Platform on AWS, Google Cloud Agent Platform oder Microsoft Foundry.
- Ebenfalls deaktiviert, wenn das Abrufen von Feature-Flags deaktiviert ist (Telemetrie-/Traffic-Umgebungsvariablen).

## Parameter

- `delaySeconds` (Zahl, erforderlich): Sekunden bis zur Wiederaufnahme. Die Laufzeit begrenzt den Wert automatisch auf `[60, 3600]`, sodass keine manuelle Begrenzung erforderlich ist.
- `reason` (Zeichenkette, erforderlich): Ein kurzer Satz zur Erläuterung der gewählten Verzögerung. Wird dem Benutzer angezeigt und in der Telemetrie aufgezeichnet. Seien Sie konkret — „langer bun-Build wird geprüft" ist hilfreicher als „warten."
- `prompt` (Zeichenkette, erforderlich): Die beim Aufwachen auszulösende `/loop`-Eingabe. Bei jeder Runde dieselbe Zeichenkette übergeben, damit das nächste Feuern die Aufgabe wiederholt. Für eine autonome Schleife ohne Benutzer-Prompt den literalen Sentinel `<<autonomous-loop-dynamic>>` übergeben.

## Beispiele

### Beispiel 1: Kurze Verzögerung zum erneuten Prüfen eines sich schnell ändernden Signals (Cache warm halten)

Ein Build wurde gerade gestartet und dauert typischerweise zwei bis drei Minuten.

```json
{
  "delaySeconds": 120,
  "reason": "bun-Build wird geprüft, voraussichtlich fertig in ~2 Min",
  "prompt": "Build-Status prüfen und Fehler melden"
}
```

120 Sekunden halten den Gesprächskontext im Anthropic-Prompt-Cache (TTL 5 Min.), sodass das nächste Aufwachen schneller und günstiger ist.

### Beispiel 2: Langer Leerlauf-Tick (Cache-Miss akzeptieren, über längere Wartezeit amortisieren)

Eine Datenbankmigrierung läuft und dauert typischerweise 20–40 Minuten.

```json
{
  "delaySeconds": 1200,
  "reason": "Migration dauert typisch 20–40 Min.; in 20 Min. erneut prüfen",
  "prompt": "Migrationsstatus prüfen und bei Abschluss fortfahren"
}
```

Beim Aufwachen ist der Cache kalt, aber die 20-minütige Wartezeit amortisiert den einzelnen Cache-Miss mehr als ausreichend. Alle 5 Minuten abzufragen würde denselben Miss-Preis viermal zahlen, ohne Nutzen.

## Hinweise

- **5-Minuten-Cache-TTL**: Der Anthropic-Prompt-Cache läuft nach 300 Sekunden ab. Verzögerungen unter 300 s halten den Kontext warm; Verzögerungen über 300 s verursachen beim nächsten Aufwachen einen Cache-Miss.
- **Genau 300 s vermeiden**: Das ist das schlechteste Ergebnis beider Welten — der Cache-Miss wird bezahlt, ohne eine sinnvoll längere Wartezeit zu erhalten. Entweder auf 270 s reduzieren (Cache warm halten) oder auf 1200 s oder mehr festlegen (ein Miss kauft eine deutlich längere Wartezeit).
- **Standard für Leerlauf-Ticks**: Wenn kein bestimmtes Signal zu beobachten ist, **1200–1800 s** (20–30 Min.) verwenden. So prüft die Schleife regelmäßig, ohne 12× pro Stunde den Cache ohne Grund zu verbrennen.
- **Automatische Begrenzung**: Die Laufzeit begrenzt `delaySeconds` auf `[60, 3600]`. Werte unter 60 werden zu 60; Werte über 3600 werden zu 3600. Diese Grenzen müssen nicht selbst gehandhabt werden.
- **Aufruf weglassen zum Beenden der Schleife**: Wenn Iterationen gestoppt werden sollen, ScheduleWakeup nicht aufrufen. Das bloße Weglassen des Aufrufs beendet die Schleife.
- **Jede Runde denselben `prompt` übergeben**: Das `prompt`-Feld muss bei jedem Aufruf die ursprüngliche `/loop`-Anweisung enthalten, damit das nächste Aufwachen weiß, welche Aufgabe fortgesetzt werden soll.
