# TaskCreate

Erstellt eine neue Aufgabe in der Aufgabenliste des aktuellen Teams (oder der Aufgabenliste der Sitzung, wenn kein Team aktiv ist). Verwenden Sie es, um Arbeitseinheiten zu erfassen, die verfolgt, delegiert oder später wieder aufgegriffen werden sollen.

## Wann verwenden

- Der Benutzer beschreibt eine mehrstufige Arbeitseinheit, die von expliziter Verfolgung profitiert.
- Sie zerlegen eine große Anfrage in kleinere, separat abschließbare Einheiten.
- Eine Folgeaufgabe wird während der Arbeit entdeckt und soll nicht vergessen werden.
- Sie benötigen einen dauerhaften Nachweis der Absicht, bevor Sie Arbeit an ein Teammitglied oder einen Subagenten übergeben.
- Sie arbeiten im Planmodus und möchten jeden Planschritt als konkrete Aufgabe darstellen.

Überspringen Sie `TaskCreate` für triviale Einmalaktionen, reine Unterhaltung oder alles, was in zwei oder drei direkten Tool-Aufrufen abgeschlossen werden kann.

## Aktivierung

- Auf den meisten Modellen standardmäßig verfügbar.
- Nicht verfügbar auf Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 und neueren Familien (v2.1.233+), außer bei Aktivierung über `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` oder `--tools`.
- Das gesamte Aufgaben-System ist deaktiviert, wenn `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parameter

- `subject` (string, erforderlich): Kurzer Imperativ-Titel, z. B. `Fix login redirect on Safari`. Unter etwa achtzig Zeichen halten.
- `description` (string, erforderlich): Ausführlicher Kontext – das Problem, die Einschränkungen, Akzeptanzkriterien und alle Dateien oder Links, die ein zukünftiger Leser benötigt. Schreiben Sie so, als würde ein Teammitglied dies ohne Vorwissen übernehmen.
- `activeForm` (string, optional): Verlaufsform-Spinnertext, der angezeigt wird, während die Aufgabe `in_progress` ist, z. B. `Fixing login redirect on Safari`. Spiegeln Sie das `subject` in der -ing-Form wider.
- `metadata` (object, optional): Beliebige strukturierte Daten, die der Aufgabe angehängt sind. Typische Verwendungen: Labels, Prioritätshinweise, externe Ticket-IDs oder agentenspezifische Konfiguration.

Neu erstellte Aufgaben beginnen stets mit Status `pending` und ohne Besitzer. Abhängigkeiten (`blocks`, `blockedBy`) werden beim Anlegen nicht gesetzt – wenden Sie diese danach mit `TaskUpdate` an.

## Beispiele

### Beispiel 1

Einen gerade gemeldeten Bugreport des Benutzers erfassen.

```
TaskCreate(
  subject: "Repair broken PDF export on Windows",
  description: "Users on Windows 11 report the export button produces a 0-byte file. Reproduce with sample doc in test/fixtures/export/, then fix the code path in src/export/pdf.ts. Acceptance: export writes a valid PDF and the existing export test suite passes.",
  activeForm: "Repairing broken PDF export on Windows"
)
```

### Beispiel 2

Ein Epic am Anfang einer Sitzung in verfolgbare Einheiten aufteilen.

```
TaskCreate(
  subject: "Draft migration plan for auth service",
  description: "Produce a written plan covering rollout stages, rollback strategy, and monitoring. Output: docs/auth-migration.md.",
  activeForm: "Drafting migration plan for auth service",
  metadata: { "priority": "P1", "linearId": "AUTH-214" }
)
```

## Hinweise

- Schreiben Sie das `subject` im Imperativ und das `activeForm` in der Verlaufsform, damit die UI natürlich lesbar bleibt, wenn die Aufgabe in `in_progress` übergeht.
- Rufen Sie `TaskList` vor dem Erstellen auf, um Duplikate zu vermeiden – die Teamliste wird mit Teammitgliedern und Subagenten geteilt.
- Schließen Sie keine Geheimnisse oder Anmeldedaten in `description` oder `metadata` ein; Aufgaben-Datensätze sind für alle mit Zugriff auf das Team sichtbar.
- Nach dem Erstellen bewegen Sie die Aufgabe mit `TaskUpdate` durch ihren Lebenszyklus. Lassen Sie keine Arbeit stillschweigend in `in_progress` zurück.
