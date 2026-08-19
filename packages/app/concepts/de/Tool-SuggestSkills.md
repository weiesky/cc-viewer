# SuggestSkills

Rendert eine Karte eigenständiger Skills, die der Benutzer hinzufügen kann (Skills, die noch nicht aktiviert sind), basierend auf Themen-Stichwörtern.

## Wann verwenden

- Die Anfrage des Benutzers passt zu Skills, die er nicht aktiviert hat (`trigger="user_asked"`, wenn er gefragt hat, `trigger="proactive"`, wenn Sie unaufgefordert vorschlagen).

## Aktivierung

- Nur wenn ein Remote-Control-Client verbunden ist oder die Sitzung in einer verwalteten Cloud-Umgebung läuft.
- Unter HIPAA-Enterprise-Konfigurationen deaktiviert.
- Nicht im Brief-Modus.

## Parameter

- `keywords` (array of strings, erforderlich): Themen-Stichwörter aus der Anfrage des Benutzers. 1–8 Elemente, jedes 1–64 Zeichen.
- `contextLabel` (string, optional): Kurze Beschriftung, die den Vorschlag mit der Anfrage verknüpft (maximal 128 Zeichen).
- `trigger` (string, optional): Wie dieser Vorschlag entstanden ist – `user_asked` oder `proactive`.

## Beispiele

### Beispiel 1: Skills nach Thema vorschlagen

```
SuggestSkills(keywords=["data visualization", "charts"], contextLabel="For building the dashboard", trigger="user_asked")
```

Bereits aktivierte Skills werden aus dem Ergebnis herausgefiltert.

## Hinweise

- Rendert nur eine Vorschlagskarte – das Hinzufügen eines Skills erfolgt separat; rufen Sie anschließend `ListSkills` zur Bestätigung auf.