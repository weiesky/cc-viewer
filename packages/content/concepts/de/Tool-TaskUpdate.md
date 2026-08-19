# TaskUpdate

Ändert eine bestehende Aufgabe – ihren Status, Inhalt, Besitz, Metadaten oder Abhängigkeitskanten. So durchlaufen Aufgaben ihren Lebenszyklus und so wird Arbeit zwischen Claude Code, Teammitgliedern und Subagenten übergeben.

## Wann verwenden

- Eine Aufgabe während der Bearbeitung durch den Status-Workflow führen.
- Eine Aufgabe beanspruchen, indem Sie sich selbst (oder einen anderen Agenten) als `owner` zuweisen.
- Das `subject` oder `description` verfeinern, sobald Sie mehr über das Problem erfahren.
- Neu entdeckte Abhängigkeiten mit `addBlocks` / `addBlockedBy` erfassen.
- Strukturierte `metadata` anhängen, wie externe Ticket-IDs oder Prioritätshinweise.

## Aktivierung

- Auf den meisten Modellen standardmäßig verfügbar.
- Nicht verfügbar auf Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 und neueren Familien (v2.1.233+), außer bei Aktivierung über `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` oder `--tools`.
- Das gesamte Aufgaben-System ist deaktiviert, wenn `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parameter

- `taskId` (string, erforderlich): Die zu ändernde Aufgabe. Aus `TaskList` oder `TaskCreate` beziehen.
- `status` (string, optional): Einer von `pending`, `in_progress`, `completed`, `deleted`.
- `subject` (string, optional): Ersatz-Imperativ-Titel.
- `description` (string, optional): Ersatz für die ausführliche Beschreibung.
- `activeForm` (string, optional): Ersatz-Verlaufsform-Spinnertext.
- `owner` (string, optional): Agent- oder Teammitglied-Handle, das die Verantwortung für die Aufgabe übernimmt.
- `metadata` (object, optional): In die Aufgabe einzumischende Metadaten-Schlüssel. Einen Schlüssel auf `null` setzen, um ihn zu löschen.
- `addBlocks` (array of strings, optional): Aufgaben-IDs, die diese Aufgabe blockiert.
- `addBlockedBy` (array of strings, optional): Aufgaben-IDs, die vor dieser abgeschlossen sein müssen.

## Status-Workflow

Der Lebenszyklus ist bewusst linear: `pending` → `in_progress` → `completed`. `deleted` ist terminal und wird verwendet, um Aufgaben zurückzuziehen, an denen nie gearbeitet wird.

- Setzen Sie `in_progress` genau in dem Moment, in dem Sie tatsächlich mit der Arbeit beginnen, nicht vorher. Es sollte immer nur eine Aufgabe pro Besitzer `in_progress` sein.
- Setzen Sie `completed` nur, wenn die Arbeit vollständig erledigt ist – Akzeptanzkriterien erfüllt, Tests bestehen, Ausgabe geschrieben. Tritt ein Blocker auf, lassen Sie die Aufgabe `in_progress` und legen Sie eine neue Aufgabe an, die beschreibt, was gelöst werden muss.
- Markieren Sie eine Aufgabe niemals als `completed`, wenn Tests fehlschlagen, die Implementierung unvollständig ist oder Sie auf ungelöste Fehler stoßen.
- Verwenden Sie `deleted` für Aufgaben, die storniert werden oder Duplikate sind; nutzen Sie eine Aufgabe nicht für unbeteiligte Arbeit um.

## Beispiele

### Beispiel 1

Eine Aufgabe beanspruchen und starten.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "in_progress",
  owner: "main-agent"
)
```

### Beispiel 2

Die Arbeit abschließen und eine Folgeabhängigkeit erfassen.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "completed"
)

TaskUpdate(
  taskId: "t_01FOLLOWUP...",
  addBlockedBy: ["t_01HXYZ..."]
)
```

## Hinweise

- `metadata` wird schlüsselweise zusammengeführt; die Übergabe von `null` für einen Schlüssel entfernt ihn. Rufen Sie zuerst `TaskGet` auf, wenn Sie sich über den aktuellen Inhalt unsicher sind.
- `addBlocks` und `addBlockedBy` hängen Kanten an; sie entfernen keine bestehenden. Ein destruktives Bearbeiten des Graphen erfordert einen eigenen Workflow – konsultieren Sie den Team-Besitzer, bevor Sie Abhängigkeiten umschreiben.
- Halten Sie `activeForm` synchron, wenn Sie `subject` ändern, damit der Spinner-Text weiterhin natürlich liest.
- Markieren Sie eine Aufgabe nicht als `completed`, um sie zum Schweigen zu bringen. Hat der Benutzer die Arbeit storniert, verwenden Sie `deleted` mit einer kurzen Begründung in `description`.
- Lesen Sie vor dem Aktualisieren den neuesten Zustand einer Aufgabe mit `TaskGet` – Teammitglieder könnten sie zwischen Ihrem letzten Lesen und Schreiben geändert haben.
