# SendUserFile

Sendet eine oder mehrere Dateien an den Benutzer – generierte Artefakte, Screenshots, Berichte – mit Kontrolle darüber, wie der Client sie darstellt.

## Wann verwenden

- Sie haben eine Datei erzeugt, die der Benutzer benötigt (einen Bericht, ein Bild, eine HTML-Seite), und möchten sie in den Vordergrund rücken, statt nur ihren Pfad zu erwähnen.
- Mit einem Anhang antworten (`status="normal"`) oder proaktiv etwas in den Vordergrund rücken, wonach der Benutzer nicht gefragt hat, das er aber jetzt sehen muss (`status="proactive"`).

## Aktivierung

- Nur verfügbar, wenn ein Remote-Control-Client verbunden ist oder die Sitzung in einer verwalteten Cloud-Umgebung läuft (z. B. Claude Code im Web).
- Nicht verfügbar auf Amazon Bedrock, Google Cloud oder Microsoft Foundry.
- Erfordert, dass die Sitzung das Senden von Dateien erlaubt (eine über Einstellungen/Feature-Flags freigeschaltete Fähigkeit); im Brief-Modus nicht verfügbar.

## Parameter

- `files` (array of strings, erforderlich): An den Benutzer zu sendende Dateipfade (absolut oder relativ zum cwd). Übergeben Sie immer ein Array, auch bei einer einzelnen Datei.
- `caption` (string, optional): Kurze Beschriftung für die Datei(en).
- `status` (string, erforderlich): `proactive`, wenn eine Datei in den Vordergrund gerückt wird, nach der der Benutzer nicht gefragt hat und die er jetzt sehen muss – ein generiertes Artefakt, ein fertiger Bericht; `normal`, wenn auf etwas geantwortet wird, das der Benutzer gerade gesagt hat.
- `display` (string, optional): `render` öffnet die Datei inline im Seitenpanel (HTML, SVG, Mermaid, Bilder, PDFs); `attach` zeigt nur eine Download-Karte (Ergebnisse, die der Benutzer speichert und woanders öffnet). Weglassen, um den Client nach Dateityp entscheiden zu lassen.

## Beispiele

### Beispiel 1: Einen generierten Bericht zustellen

```
SendUserFile(
  files=["./out/weekly-report.html"],
  caption="Weekly usage report",
  status="proactive",
  display="render"
)
```

## Hinweise

- Wählen Sie `display="attach"` für Dateien, die der Benutzer speichert und in einer anderen App öffnet; `render` für alles, was er sich sofort ansehen sollte.
