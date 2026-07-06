# TeamCreate

## Definition

Erstellt ein neues Team zur Koordination mehrerer Agenten, die an einem Projekt arbeiten. Teams ermöglichen parallele Aufgabenausführung über eine gemeinsame Aufgabenliste und agentenübergreifende Kommunikation.

## Parameter

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `team_name` | string | Ja | Name des neuen Teams |
| `description` | string | Nein | Team-Beschreibung / Zweck |
| `agent_type` | string | Nein | Typ / Rolle des Team-Leiters |

## Was erstellt wird

- **Team-Konfigurationsdatei**: `~/.claude/teams/{team-name}/config.json` — speichert Mitgliederliste und Metadaten
- **Aufgabenlisten-Verzeichnis**: `~/.claude/tasks/{team-name}/` — gemeinsame Aufgabenliste für alle Teammitglieder

Teams stehen in einem 1:1-Verhältnis zu Aufgabenlisten.

## Team-Workflow

1. **TeamCreate** — Team und zugehörige Aufgabenliste erstellen
2. **TaskCreate** — Aufgaben für das Team definieren
3. **Agent** (mit `team_name` + `name`) — Teammitglieder starten, die dem Team beitreten
4. **TaskUpdate** — Aufgaben über `owner` an Teammitglieder zuweisen
5. Teammitglieder bearbeiten Aufgaben und kommunizieren über **SendMessage**
6. Teammitglieder beenden, dann **TeamDelete** zur Bereinigung

## Verwandte Tools

| Tool | Zweck |
|------|-------|
| `TeamDelete` | Team und Aufgabenverzeichnisse entfernen |
| `SendMessage` | Kommunikation zwischen Agenten innerhalb des Teams |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | Gemeinsame Aufgabenliste verwalten |
| `Agent` | Teammitglieder starten, die dem Team beitreten |
