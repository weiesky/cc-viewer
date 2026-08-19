# Projects

Verwaltet Projektdokumente in der Claude-Projekt-Wissensbasis des Benutzers: Dokumente lesen, durchsuchen, schreiben und löschen oder Projektinformationen abrufen.

## Wann verwenden

- Ein Dokument (Ergebnis, Notizen, Referenzmaterial) dauerhaft im Projekt des Benutzers speichern, damit es die Sitzung übersteht.
- Vorhandene Projektdokumente lesen oder durchsuchen, um die aktuelle Aufgabe in früherem Kontext zu verankern.
- Eine lokale Datei ins Projekt hochladen, ohne ihren Inhalt in den Kontext zu laden.
- Ein veraltetes Projektdokument entfernen.

## Parameter

- `method` (string, erforderlich): Einer von `project_info`, `project_read`, `project_search`, `project_write`, `project_delete`.
- `path` (string, optional): Für `project_read`/`project_write`/`project_delete`: der Dokumentpfad. Für `project_write`: Ein vorhandener Pfad wird an Ort und Stelle ersetzt; ein neuer reiner Dateiname (ohne "/") wird in den Namespace `claude/<name>` eingeordnet.
- `content` (string, optional): Für `project_write`: Inline-Dokumenttext. Schließt `local_path` gegenseitig aus.
- `local_path` (string, optional): Für `project_write`: eine Datei innerhalb des Arbeitsverzeichnisses zum Hochladen – der Inhalt gelangt nie in Ihren Kontext. Schließt `content` gegenseitig aus.
- `present_to_user` (boolean, optional): Für `project_write`: markiert dieses Dokument als das Ergebnis, das der Benutzer sehen muss. Standard ist false; für routinemäßiges Speichern und Massenschreibvorgänge nicht setzen.
- `query` (string, optional): Für `project_search`: Wissensbasis-Abfrage.
- `n` (number, optional): Für `project_search`: Anzahl der Treffer (Standard 5).

## Beispiele

### Beispiel 1: Das Ergebnis ins Projekt schreiben

```
Projects(
  method="project_write",
  path="claude/migration-plan.md",
  local_path="./migration-plan.md",
  present_to_user=true
)
```

Lädt die lokale Datei hoch, ohne ihren Inhalt in den Kontext zu ziehen, und kennzeichnet sie als Ergebnis des Benutzers.

### Beispiel 2: Die Wissensbasis durchsuchen

```
Projects(method="project_search", query="authentication refresh tokens", n=5)
```

## Hinweise

- `content` ist für Text, den Sie inline verfassen; `local_path` ist für alles, was bereits auf der Festplatte liegt – mischen Sie beides niemals.
- Setzen Sie `present_to_user=true` sparsam ein: nur für das eine Dokument, das der Benutzer angefordert hat oder auf das er reagieren muss.
