# TeamDelete

## Definition

Entfernt ein Team und die zugehörigen Aufgabenverzeichnisse, wenn die Multi-Agent-Kollaborationsarbeit abgeschlossen ist. Dies ist das Bereinigungs-Gegenstück zu TeamCreate.

## Verhalten

- Entfernt das Team-Verzeichnis: `~/.claude/teams/{team-name}/`
- Entfernt das Aufgabenverzeichnis: `~/.claude/tasks/{team-name}/`
- Löscht den Team-Kontext aus der aktuellen Sitzung

**Wichtig**: TeamDelete schlägt fehl, wenn das Team noch aktive Mitglieder hat. Teammitglieder müssen zuvor über SendMessage-Shutdown-Anfragen ordnungsgemäß beendet werden.

## Typische Verwendung

TeamDelete wird am Ende eines Team-Workflows aufgerufen:

1. Alle Aufgaben sind abgeschlossen
2. Teammitglieder werden über `SendMessage` mit `shutdown_request` beendet
3. **TeamDelete** entfernt Team- und Aufgabenverzeichnisse

## Verwandte Tools

| Tool | Zweck |
|------|-------|
| `TeamCreate` | Neues Team und zugehörige Aufgabenliste erstellen |
| `SendMessage` | Kommunikation mit Teammitgliedern / Shutdown-Anfragen senden |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | Gemeinsame Aufgabenliste verwalten |
| `Agent` | Teammitglieder starten, die dem Team beitreten |
