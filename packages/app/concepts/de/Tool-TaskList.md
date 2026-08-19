# TaskList

Gibt jede Aufgabe im aktuellen Team (oder der Sitzung) in zusammengefasster Form zurück. Verwenden Sie es, um ausstehende Arbeit zu überblicken, zu entscheiden, was als Nächstes aufgenommen wird, und Duplikate zu vermeiden.

## Wann verwenden

- Zu Beginn einer Sitzung, um zu sehen, was bereits verfolgt wird.
- Vor dem Aufruf von `TaskCreate`, um zu bestätigen, dass die Arbeit nicht bereits erfasst ist.
- Beim Entscheiden, welche Aufgabe Sie als Teammitglied oder Subagent als Nächstes übernehmen.
- Zum schnellen Überprüfen von Abhängigkeitsbeziehungen im Team.
- Regelmäßig während langer Sitzungen, um sich mit Teammitgliedern neu zu synchronisieren, die Aufgaben beansprucht, abgeschlossen oder hinzugefügt haben.

`TaskList` ist schreibgeschützt und günstig; rufen Sie es beliebig auf, wann immer Sie einen Überblick benötigen.

## Aktivierung

- Auf den meisten Modellen standardmäßig verfügbar.
- Nicht verfügbar auf Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 und neueren Familien (v2.1.233+), außer bei Aktivierung über `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` oder `--tools`.
- Das gesamte Aufgaben-System ist deaktiviert, wenn `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parameter

`TaskList` nimmt keine Parameter entgegen. Es gibt stets die vollständige Aufgabenmenge für den aktiven Kontext zurück.

## Antwortform

Jede Aufgabe in der Liste ist eine Zusammenfassung, nicht der vollständige Datensatz. Rechnen Sie etwa mit:

- `id` – stabiler Bezeichner zur Verwendung mit `TaskGet` / `TaskUpdate`.
- `subject` – kurzer Imperativ-Titel.
- `status` – einer von `pending`, `in_progress`, `completed`, `deleted`.
- `owner` – Agent- oder Teammitglieds-Handle, oder leer bei nicht beanspruchten Aufgaben.
- `blockedBy` – Array von Aufgaben-IDs, die zuerst abgeschlossen sein müssen.

Für die vollständige Beschreibung, Akzeptanzkriterien oder Metadaten einer bestimmten Aufgabe folgt ein `TaskGet`.

## Beispiele

### Beispiel 1

Schnelle Statusprüfung.

```
TaskList()
```

Die Ausgabe nach allem `in_progress` ohne `owner` (verwaiste Arbeit) und allem `pending` mit leerem `blockedBy` (aufnahmebereit) scannen.

### Beispiel 2

Teammitglied, das die nächste Aufgabe auswählt.

```
TaskList()
# Filter to: status == pending AND blockedBy is empty AND owner is empty.
# Among those, prefer the lower ID (tasks are typically numbered in
# creation order, so lower IDs are older and usually higher priority).
TaskGet(taskId: "<chosen id>")
TaskUpdate(taskId: "<chosen id>", status: "in_progress", owner: "<your handle>")
```

## Hinweise

- Teammitglieds-Heuristik: Wenn mehrere `pending`-Aufgaben unblockiert und nicht beansprucht sind, wählen Sie die niedrigste ID. Dies hält die Arbeit FIFO und verhindert, dass zwei Agenten dieselbe prominente Aufgabe greifen.
- `blockedBy` respektieren: Starten Sie keine Aufgabe, deren Blocker noch `pending` oder `in_progress` sind. Arbeiten Sie zuerst am Blocker oder koordinieren Sie sich mit dessen Besitzer.
- `TaskList` ist der einzige Entdeckungsmechanismus für Aufgaben. Es gibt keine Suche; wenn die Liste lang ist, scannen Sie strukturell (nach Status, dann nach Besitzer).
- Gelöschte Aufgaben erscheinen möglicherweise weiterhin in der Liste mit Status `deleted` zur Nachvollziehbarkeit. Für Planungszwecke ignorieren.
- Die Liste spiegelt den Live-Zustand des Teams wider, Teammitglieder können zwischen Aufrufen Aufgaben hinzufügen oder beanspruchen. Wenn Zeit vergangen ist, vor dem Beanspruchen erneut auflisten.
