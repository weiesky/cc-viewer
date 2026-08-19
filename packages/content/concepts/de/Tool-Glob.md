# Glob

Gleicht Dateinamen gegen ein Glob-Muster ab und gibt die Pfade zurück, sortiert nach neuester Änderungszeit zuerst. Optimiert, um Dateien in Codebases jeder Größe schnell zu finden, ohne auf `find` zurückzugreifen.

## Wann verwenden

- Aufzählen aller Dateien einer bestimmten Erweiterung (zum Beispiel alle `*.ts`-Dateien unter `src`)
- Auffinden von Konfigurations- oder Fixture-Dateien anhand von Namenskonventionen (`**/jest.config.*`, `**/*.test.tsx`)
- Einschränken der Suchfläche, bevor ein gezieltes `Grep` ausgeführt wird
- Prüfen, ob eine Datei unter einem bekannten Muster bereits existiert, bevor `Write` aufgerufen wird
- Auffinden kürzlich geänderter Dateien, indem die Sortierung nach Änderungszeit genutzt wird

## Parameter

- `pattern` (string, erforderlich): Der Glob-Ausdruck zum Abgleich. Unterstützt `*` für Einzelsegment-Wildcards, `**` für rekursive Treffer und `{a,b}` für Alternativen, zum Beispiel `src/**/*.{ts,tsx}`.
- `path` (string, optional): Verzeichnis, in dem die Suche ausgeführt wird. Muss bei Angabe ein gültiger Verzeichnispfad sein. Feld ganz weglassen, um das aktuelle Arbeitsverzeichnis zu durchsuchen. Nicht die Zeichenketten `"undefined"` oder `"null"` übergeben.

## Beispiele

### Beispiel 1: Jede TypeScript-Quelldatei
`Glob` mit `pattern: "src/**/*.ts"` aufrufen. Das Ergebnis ist eine nach mtime sortierte Liste, sodass zuletzt bearbeitete Dateien zuerst erscheinen, was nützlich ist, um sich auf Brennpunkte zu konzentrieren.

### Beispiel 2: Einen Kandidaten für eine Klassendefinition finden
Wenn Sie vermuten, dass eine Klasse in einer Datei wohnt, deren Name Sie nicht kennen, mit `pattern: "**/*UserService*"` suchen, um die Kandidaten einzugrenzen, und dann mit `Read` oder `Grep` folgen.

### Beispiel 3: Parallele Erkundung vor einer größeren Aufgabe
In einer einzigen Nachricht mehrere `Glob`-Aufrufe absetzen (zum Beispiel einen für `**/*.test.ts` und einen für `**/fixtures/**`), damit beide parallel laufen und ihre Ergebnisse korreliert werden können.

## Hinweise

- Die Ergebnisse sind nach Dateimodifikationszeit sortiert (neueste zuerst), nicht alphabetisch. Sortieren Sie nachgelagert, wenn Sie eine stabile Reihenfolge benötigen.
- Muster werden vom Tool ausgewertet, nicht von der Shell; Sie müssen sie nicht so quotieren oder escapen wie in der Kommandozeile.
- Für offene Exploration, die mehrere Runden Suche und Reasoning erfordert, delegieren Sie an eine `Agent` mit dem Explore-Agenten-Typ, statt viele `Glob`-Aufrufe zu verketten.
- Bevorzugen Sie `Glob` gegenüber `Bash`-Aufrufen von `find` oder `ls` für die Dateinamensfindung; es behandelt Berechtigungen konsistent und gibt strukturierte Ausgabe zurück.
- Wenn Sie nach Inhalten innerhalb von Dateien statt nach Dateinamen suchen, verwenden Sie stattdessen `Grep`.
