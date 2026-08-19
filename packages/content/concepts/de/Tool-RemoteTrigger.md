# RemoteTrigger

Ruft die claude.ai Remote-Trigger-API auf, um geplante Aufgaben und bedarfsgesteuerte Trigger-Ausführungen zu verwalten. Das OAuth-Token wird intern vom Tool verarbeitet und ist weder für das Modell noch für die Shell sichtbar.

## Wann verwenden

- Verwaltung von Remote-Agenten (Triggern) auf claude.ai — einschließlich Auflisten, Prüfen und Aktualisieren vorhandener Trigger
- Erstellen einer neuen cron-basierten automatisierten Aufgabe, die einen Claude-Agenten nach einem wiederkehrenden Zeitplan ausführt
- Manuelles Ausführen eines vorhandenen Triggers ohne Warten auf den nächsten geplanten Zeitpunkt
- Auflisten oder Überprüfen aller aktuellen Trigger, um deren Konfiguration und Status zu prüfen
- Aktualisieren von Trigger-Einstellungen wie Zeitplan, Payload oder Beschreibung, ohne den Trigger neu erstellen zu müssen

## Aktivierung

- Erfordert einen claude.ai-Plan Pro, Max, Team oder Enterprise.
- Nicht verfügbar auf Amazon Bedrock, Claude Platform on AWS, Google Cloud oder Microsoft Foundry.
- Erfordert serverseitige Feature-Flags und die Richtlinieneinstellungen `allow_remote_sessions` / `allow_routines`.
- Nicht für Remote-Sitzungen selbst.

## Parameter

- `action` (string, erforderlich): die auszuführende Operation — eines von `list`, `get`, `create`, `update` oder `run`
- `trigger_id` (string, erforderlich für `get`, `update` und `run`): der Bezeichner des Triggers, der bearbeitet werden soll; muss dem Muster `^[\w-]+$` entsprechen (nur Wortzeichen und Bindestriche)
- `body` (object, erforderlich für `create` und `update`; optional für `run`): die an die API gesendete Anfrage-Payload

## Beispiele

### Beispiel 1: Alle Trigger auflisten

```json
{
  "action": "list"
}
```

Ruft `GET /v1/code/triggers` auf und gibt ein JSON-Array aller Trigger zurück, die mit dem authentifizierten Konto verknüpft sind.

### Beispiel 2: Einen neuen Trigger erstellen, der jeden Werktag morgens ausgeführt wird

```json
{
  "action": "create",
  "body": {
    "name": "weekday-morning-report",
    "schedule": "0 8 * * 1-5",
    "description": "Täglich eine Zusammenfassung an jedem Werktag um 08:00 UTC erstellen"
  }
}
```

Ruft `POST /v1/code/triggers` mit dem angegebenen Body auf und gibt das neu erstellte Trigger-Objekt zurück, einschließlich der zugewiesenen `trigger_id`.

### Beispiel 3: Einen Trigger sofort ausführen

```json
{
  "action": "run",
  "trigger_id": "my-report-trigger"
}
```

Ruft sofort `POST /v1/code/triggers/my-report-trigger/run` auf und umgeht dabei den geplanten Zeitpunkt.

### Beispiel 4: Einen einzelnen Trigger abrufen

```json
{
  "action": "get",
  "trigger_id": "my-report-trigger"
}
```

Ruft `GET /v1/code/triggers/my-report-trigger` auf und gibt die vollständige Trigger-Konfiguration zurück.

## Hinweise

- Das OAuth-Token wird vom Tool prozessintern injiziert — kopieren, einfügen oder protokollieren Sie Token niemals manuell; dies stellt ein Sicherheitsrisiko dar und ist bei der Verwendung dieses Tools nicht erforderlich.
- Verwenden Sie dieses Tool für alle Trigger-API-Aufrufe anstelle von rohem `curl` oder anderen HTTP-Clients; die direkte Verwendung von HTTP umgeht die sichere Token-Injektion und kann Anmeldedaten offenlegen.
- Das Tool gibt die rohe JSON-Antwort der API zurück; der Aufrufer ist für das Parsen der Antwort und die Behandlung von Fehlerstatuscodes verantwortlich.
- Der `trigger_id`-Wert muss dem Muster `^[\w-]+$` entsprechen — nur alphanumerische Zeichen, Unterstriche und Bindestriche sind zulässig; Leerzeichen oder Sonderzeichen führen dazu, dass die Anfrage fehlschlägt.
