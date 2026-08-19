# Body Diff JSON (Inkrementeller Request-Body-Vergleich)

## Hintergrund

Der MainAgent von Claude Code verwendet einen Vollkontext-Sendemechanismus – jede Anfrage enthält den vollständigen Gesprächsverlauf, System-Prompt, Tool-Definitionen usw. Das bedeutet, dass der Request-Body im Laufe des Gesprächs immer größer wird und es schwierig ist, im Roh-Body schnell zu erkennen, „was in dieser Runde tatsächlich neu hinzugekommen ist".

Body Diff JSON löst genau dieses Problem: Es vergleicht automatisch die Bodies zweier aufeinanderfolgender MainAgent-Anfragen, extrahiert die inkrementellen Teile und zeigt auf einen Blick, welche Inhalte in dieser Anfrage tatsächlich neu sind.

## Funktionsweise

1. **Erkennung aufeinanderfolgender MainAgent-Anfragen**: Die aktuelle Anfrage muss vom Typ MainAgent sein, und es muss eine vorherige MainAgent-Anfrage existieren
2. **Feldweiser Vergleich**: Alle Top-Level-Felder des Request-Body werden durchlaufen, interne Attribute mit `_`-Präfix werden übersprungen
3. **Intelligente Differenzextraktion**:
   - Neue Felder: werden direkt angezeigt
   - Gelöschte Felder: werden nicht angezeigt (beeinträchtigen normalerweise nicht das Verständnis)
   - Geänderte Felder: zeigen den aktuellen Wert
   - `messages`-Array wird speziell behandelt: Es werden nur neue Nachrichten angezeigt (da im normalen Gespräch Nachrichten angehängt werden und die Präfix-Nachrichten unverändert bleiben)
4. **Erkennung einer Verkleinerung des Request-Body**: Wenn der aktuelle Request-Body kleiner ist als der vorherige, deutet dies auf eine Kontextkürzung oder Sitzungszurücksetzung hin – in diesem Fall wird ein Hinweis statt eines Diffs angezeigt

## Typische Szenarien

In einer normalen Gesprächsrunde enthält Body Diff JSON normalerweise nur:
- `messages`: 1–2 neue Nachrichten (Benutzereingabe + Antwort des Assistenten aus der vorherigen Runde)

Wenn im Diff Änderungen an Feldern wie `system`, `tools`, `model` usw. erscheinen, bedeutet dies, dass sich die Konfiguration in dieser Runde geändert hat – was oft auch der Grund für einen Cache-Rebuild ist.

## Verwendung

- Body Diff JSON wird im Detailbereich der MainAgent-Anfrage angezeigt
- Klicken Sie auf den Titel zum Auf-/Zuklappen
- Unterstützt JSON- und Text-Ansichtsmodi sowie Ein-Klick-Kopieren
- Unter **CC-Viewer → Globale Einstellungen** (oben links) können Sie „Body Diff JSON standardmäßig aufklappen" einstellen
