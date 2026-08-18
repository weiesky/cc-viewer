# REPL

Führt JavaScript in einem persistenten Node.js-vm-Kontext innerhalb der Sitzung aus. Top-Level-`await` wird unterstützt, und Variablen/Funktionen, die in einem Aufruf definiert wurden, bleiben in späteren Aufrufen verfügbar.

## Wann verwenden

- Schnelle Berechnungen, Datentransformationen oder JSON-Bearbeitung, die in Code einfacher sind als in Shell-Einzeilern.
- Mehrstufiges Skripting, bei dem Zwischenzustand zwischen Aufrufen erhalten bleiben soll (Zähler, aufsummierte Ergebnisse).
- Interaktives Ausprobieren des Verhaltens einer API oder Bibliothek, bevor es in eine Datei geschrieben wird.

## Parameter

- `code` (string, erforderlich): Auszuführender JavaScript-Code. Unterstützt Top-Level-await. Der Zustand bleibt über Aufrufe hinweg erhalten.
- `description` (string, optional): Klare, prägnante Beschreibung dessen, was dieses Skript tut, im Aktiv (5–10 Wörter), z. B. "Trace upgrade message to its GrowthBook flag".
- `timeout` (number, optional): Timeout in Millisekunden. Standard ist 30000; Maximum 600000.

## Beispiele

### Beispiel 1: Zustand berechnen und wiederverwenden

```
REPL(code="const counts = new Map(); ['a','b','a'].forEach(k => counts.set(k, (counts.get(k)||0)+1)); counts.get('a')")
```

Gibt `2` zurück; `counts` bleibt für nachfolgende REPL-Aufrufe in derselben Sitzung definiert.

### Beispiel 2: Top-Level-await mit längerem Timeout

```
REPL(
  code="const res = await fetch('https://example.com/api'); await res.json()",
  description="Fetch example API and parse JSON",
  timeout=60000
)
```

## Hinweise

- Der Zustand ist sitzungsgebunden: Ein Neustart der Sitzung löscht alle Definitionen.
- Dies ist eine JavaScript-Umgebung (Node) – verwenden Sie Bash für Shell-Befehle, dateisystemlastige Arbeiten oder Nicht-JS-Laufzeiten.
- Lange laufender Code sollte ein explizites `timeout` setzen; die Standardeinstellung von 30 s beendet alles Langsamere.
