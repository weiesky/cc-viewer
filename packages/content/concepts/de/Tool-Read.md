# Read

Lädt den Inhalt einer einzelnen Datei aus dem lokalen Dateisystem. Unterstützt Klartext, Quellcode, Bilder, PDFs und Jupyter-Notebooks und gibt die Ergebnisse mit 1-basierten Zeilennummern im `cat -n`-Stil zurück.

## Wann verwenden

- Lesen einer Quelldatei an einem bekannten Pfad vor Bearbeitung oder Analyse
- Inspizieren von Konfigurationsdateien, Lockfiles, Logs oder generierten Artefakten
- Anzeigen von Screenshots oder Diagrammen, die der Benutzer in die Unterhaltung eingefügt hat
- Extrahieren eines bestimmten Seitenbereichs aus einem langen PDF-Handbuch
- Öffnen eines `.ipynb`-Notebooks, um Code-Zellen, Markdown und Zellenausgaben gemeinsam zu überprüfen

## Parameter

- `file_path` (string, erforderlich): Absoluter Pfad zur Zieldatei. Relative Pfade werden abgelehnt.
- `offset` (integer, optional): 1-basierte Zeilennummer, ab der gelesen wird. Nützlich für große Dateien in Kombination mit `limit`.
- `limit` (integer, optional): Maximale Anzahl zurückzugebender Zeilen ab `offset`. Standard sind 2000 Zeilen vom Dateianfang, wenn weggelassen.
- `pages` (string, optional): Seitenbereich für PDF-Dateien, zum Beispiel `"1-5"`, `"3"` oder `"10-20"`. Erforderlich für PDFs länger als 10 Seiten; maximal 20 Seiten pro Anfrage.

## Beispiele

### Beispiel 1: Eine gesamte kleine Datei lesen
`Read` nur mit `file_path` auf `/Users/me/project/src/index.ts` aufrufen. Bis zu 2000 Zeilen werden mit Zeilennummern zurückgegeben, was normalerweise als Bearbeitungskontext ausreicht.

### Beispiel 2: Durch ein langes Log blättern
`offset: 5001` und `limit: 500` für eine Log-Datei mit mehreren Tausend Zeilen verwenden, um ein schmales Fenster abzurufen, ohne Kontext-Token zu verschwenden.

### Beispiel 3: Bestimmte PDF-Seiten extrahieren
Für ein 120-seitiges PDF unter `/tmp/spec.pdf` `pages: "8-15"` setzen, um nur das benötigte Kapitel herauszuziehen. Das Weglassen von `pages` bei einem großen PDF erzeugt einen Fehler.

### Beispiel 4: Ein Bild anzeigen
Den absoluten Pfad eines PNG- oder JPG-Screenshots übergeben. Das Bild wird visuell gerendert, sodass Claude Code direkt darüber schlussfolgern kann.

## Hinweise

- Immer absolute Pfade bevorzugen. Wenn der Benutzer einen angibt, vertrauen Sie ihm so, wie er ist.
- Zeilen länger als 2000 Zeichen werden gekürzt; behandeln Sie den zurückgegebenen Inhalt bei extrem breiten Daten als potenziell abgeschnitten.
- Mehrere unabhängige Dateien lesen? Setzen Sie mehrere `Read`-Aufrufe in derselben Antwort ab, damit sie parallel laufen.
- `Read` kann keine Verzeichnisse auflisten. Verwenden Sie stattdessen einen `Bash`-`ls`-Aufruf oder das `Glob`-Tool.
- Das Lesen einer vorhandenen, aber leeren Datei liefert eine System-Erinnerung statt Dateibytes, also behandeln Sie dieses Signal explizit.
- Ein erfolgreiches `Read` ist erforderlich, bevor Sie `Edit` auf derselben Datei in der aktuellen Sitzung verwenden können.
