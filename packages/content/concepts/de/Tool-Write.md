# Write

Erstellt eine neue Datei oder ersetzt den Inhalt einer bestehenden Datei im lokalen Dateisystem vollständig. Da es alles am Zielpfad ersetzt, sollte es für echte Neuerstellungen oder beabsichtigte vollständige Umschreibungen reserviert sein.

## Wann verwenden

- Erstellen einer brandneuen Quelldatei, eines Tests oder einer Konfiguration, die noch nicht existiert
- Erzeugen einer frischen Fixture, eines Snapshots oder einer Datendatei von Grund auf
- Durchführen einer vollständigen Umschreibung, bei der ein inkrementelles `Edit` komplexer wäre als ein Neustart
- Ausgeben eines angeforderten Artefakts wie eines Schemas, einer Migration oder eines Build-Skripts, das der Benutzer ausdrücklich zu erstellen angefordert hat

## Parameter

- `file_path` (string, erforderlich): Absoluter Pfad der zu schreibenden Datei. Alle übergeordneten Verzeichnisse müssen bereits existieren.
- `content` (string, erforderlich): Der vollständige in die Datei zu schreibende Text. Dies wird der gesamte Dateiinhalt.

## Beispiele

### Beispiel 1: Ein neues Hilfsmodul erstellen
`Write` mit `file_path: "/Users/me/app/src/utils/slugify.ts"` aufrufen und die Implementierung als `content` übergeben. Dies nur nach Überprüfung verwenden, dass die Datei nicht bereits existiert.

### Beispiel 2: Ein abgeleitetes Artefakt neu generieren
Nachdem sich die Schema-Quelle ändert, `/Users/me/app/generated/schema.json` in einem einzigen `Write`-Aufruf mit dem frisch generierten JSON als `content` neu schreiben.

### Beispiel 3: Eine kleine Fixture-Datei ersetzen
Für eine Wegwerf-Testfixture, bei der sich jede Zeile ändert, kann `Write` klarer sein als eine Folge von `Edit`-Aufrufen. Lesen Sie die Datei zuerst, bestätigen Sie den Umfang, und überschreiben Sie dann.

## Hinweise

- Bevor Sie eine bestehende Datei überschreiben, müssen Sie `Read` auf sie in der aktuellen Sitzung aufrufen. `Write` verweigert das Überschreiben ungesehener Inhalte.
- Bevorzugen Sie `Edit` für jede Änderung, die nur einen Teil einer Datei berührt. `Edit` sendet nur das Diff, was schneller, sicherer und leichter zu reviewen ist.
- Erstellen Sie nicht proaktiv Markdown-Dokumentation, `README.md` oder Changelog-Dateien, sofern der Benutzer sie nicht ausdrücklich anfordert.
- Fügen Sie keine Emojis, Marketing-Texte oder dekorativen Banner hinzu, sofern der Benutzer diesen Stil nicht anfordert.
- Überprüfen Sie zuerst mit einem `Bash`-`ls`-Aufruf, dass das übergeordnete Verzeichnis existiert; `Write` erstellt keine Zwischenordner.
- Liefern Sie den Inhalt genau so, wie Sie ihn persistiert haben möchten; es gibt kein Templating oder Post-Processing.
