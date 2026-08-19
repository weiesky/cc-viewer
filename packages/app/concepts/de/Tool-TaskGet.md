# TaskGet

Ruft den vollständigen Datensatz einer einzelnen Aufgabe per ID ab, einschließlich Beschreibung, aktuellem Status, Besitzer, Metadaten und Abhängigkeitskanten. Verwenden Sie es, wenn die von `TaskList` zurückgegebene Zusammenfassung nicht ausreicht, um zu handeln.

## Wann verwenden

- Sie haben eine Aufgabe aus `TaskList` aufgenommen und benötigen die vollständige Beschreibung, bevor Sie mit der Arbeit beginnen.
- Sie sind im Begriff, eine Aufgabe als `completed` zu markieren, und möchten die Akzeptanzkriterien erneut prüfen.
- Sie möchten inspizieren, welche Aufgaben diese hier `blocks` oder welche sie `blockedBy` sind, um den nächsten Schritt zu entscheiden.
- Sie untersuchen den Verlauf – wer besitzt sie, welche Metadaten wurden angehängt, wann änderte sie ihren Zustand.
- Ein Teammitglied oder eine frühere Sitzung hat eine Aufgaben-ID referenziert und Sie benötigen den Kontext.

Bevorzugen Sie `TaskList`, wenn Sie nur einen groben Überblick benötigen; reservieren Sie `TaskGet` für den konkreten Datensatz, den Sie sorgfältig lesen oder ändern wollen.

## Aktivierung

- Auf den meisten Modellen standardmäßig verfügbar.
- Nicht verfügbar auf Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 und neueren Familien (v2.1.233+), außer bei Aktivierung über `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` oder `--tools`.
- Das gesamte Aufgaben-System ist deaktiviert, wenn `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parameter

- `taskId` (string, erforderlich): Der Aufgabenbezeichner, der von `TaskCreate` oder `TaskList` zurückgegeben wird. IDs sind für die Lebensdauer der Aufgabe stabil.

## Beispiele

### Beispiel 1

Eine Aufgabe nachschlagen, die Sie gerade in der Liste gesehen haben.

```
TaskGet(taskId: "t_01HXYZ...")
```

Typische Antwortfelder: `id`, `subject`, `description`, `activeForm`, `status`, `owner`, `blocks`, `blockedBy`, `metadata`, `createdAt`, `updatedAt`.

### Beispiel 2

Abhängigkeiten vor Beginn auflösen.

```
TaskGet(taskId: "t_01HXYZ...")
# Inspect blockedBy — if any referenced task is still pending
# or in_progress, work on the blocker first.
```

## Hinweise

- `TaskGet` ist schreibgeschützt und sicher wiederholt aufzurufen; es ändert weder Status noch Besitz.
- Ist `blockedBy` nicht leer und enthält Aufgaben, die nicht `completed` sind, starten Sie diese Aufgabe nicht – lösen Sie zuerst die Blocker auf (oder koordinieren Sie sich mit deren Besitzer).
- Das `description`-Feld kann lang sein. Lesen Sie es vollständig, bevor Sie handeln; Überfliegen führt zu übersehenen Akzeptanzkriterien.
- Eine unbekannte oder gelöschte `taskId` gibt einen Fehler zurück. Führen Sie `TaskList` erneut aus, um eine aktuelle ID auszuwählen.
- Wenn Sie eine Aufgabe bearbeiten möchten, rufen Sie zuerst `TaskGet` auf, um nicht Felder zu überschreiben, die ein Teammitglied gerade geändert hat.
