# SubAgent: Search

## Definition

Search ist ein Sub-Agent-Typ, der vom Haupt-Agent von Claude Code gestartet wird, um Codebase-Suchen durchzuführen. Er führt gezielte Datei- und Inhaltssuchen mit Tools wie Glob, Grep und Read aus und gibt die Ergebnisse anschließend an den übergeordneten Agent zurück.

## Verhalten

- Wird automatisch gestartet, wenn der Haupt-Agent die Codebase durchsuchen oder erkunden muss
- Läuft in einem isolierten Kontext mit ausschließlich Lesezugriff
- Verwendet Glob für Datei-Musterabgleiche, Grep für die Inhaltssuche und Read für die Dateiinspektion
- Gibt Suchergebnisse zur weiteren Verarbeitung an den übergeordneten Agent zurück

## Wann er erscheint

Search-Sub-Agents erscheinen typischerweise wenn:

1. Der Haupt-Agent bestimmte Dateien, Funktionen oder Codemuster finden muss
2. Eine umfassende Codebase-Erkundung vom Benutzer angefordert wird
3. Der Agent Abhängigkeiten, Referenzen oder Verwendungsmuster untersucht
