# SendUserMessage

Sendet eine Nachricht an den Benutzer – der primäre sichtbare Ausgabekanal in Brief-artigen Sitzungen. Auch unter seinem Legacy-Alias `Brief` bekannt.

## Wann verwenden

- Antworten auf etwas, das der Benutzer gerade gesagt hat (`status="normal"`).
- Proaktiv etwas in den Vordergrund rücken, wonach der Benutzer nicht gefragt hat und das er jetzt sehen muss – eine Aufgabe, die während seiner Abwesenheit abgeschlossen wurde, ein Hindernis, auf das Sie gestoßen sind, eine unaufgeforderte Statusaktualisierung (`status="proactive"`).

## Parameter

Im Brief-Modus:

- `message` (string, erforderlich): Die Nachricht für den Benutzer. Unterstützt Markdown-Formatierung.
- `attachments` (array, optional): Anhänge, die zusammen mit der Nachricht angezeigt werden. Jeder Eintrag ist entweder ein Dateipfad (absolut oder relativ zum cwd) für eine lokal lesbare Datei oder ein bereits aufgelöstes `{file_uuid, file_name, size, is_image}`-Objekt, das von einem Geräte-Tool wie `attach_file` stammt.
- `status` (string, erforderlich): `proactive` für unaufgeforderte Aktualisierungen, die der Benutzer jetzt braucht; `normal`, wenn dem Benutzer geantwortet wird.

In Nicht-Brief-Builds ist nur `message` verfügbar.

## Beispiele

### Beispiel 1: Proaktive Abschlussbenachrichtigung

```
SendUserMessage(
  message="The migration finished — 42 files updated, tests green.",
  status="proactive"
)
```

## Hinweise

- Nur im Brief-Modus oder über das entsprechende Feature-Rollout aktiviert; die meisten interaktiven CLI-Sitzungen sprechen stattdessen direkt mit dem Benutzer.
- Setzen Sie `proactive` sparsam ein – es ist für Dinge gedacht, die jetzt wirklich die Aufmerksamkeit des Benutzers benötigen.
