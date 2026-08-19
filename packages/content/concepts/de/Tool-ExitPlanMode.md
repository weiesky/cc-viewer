# ExitPlanMode

Reicht den während des Planmodus entworfenen Implementierungsplan zur Genehmigung durch den Benutzer ein und führt die Sitzung – bei Genehmigung – aus dem Planmodus heraus, sodass Edits beginnen können.

## Wann verwenden

- Ein während `EnterPlanMode` geschriebener Plan ist fertig und bereit zur Überprüfung.
- Die Aufgabe ist umsetzungsorientiert (Code- oder Konfigurationsänderungen), keine reine Recherche, sodass ein expliziter Plan angebracht ist.
- Alle vorbereitende Lektüre und Analyse sind erledigt; vor der Benutzerentscheidung ist keine weitere Untersuchung nötig.
- Der Assistent hat konkrete Dateipfade, Funktionen und Schritte aufgezählt – nicht nur Ziele.
- Der Benutzer hat um den Plan gebeten, oder der Planmodus-Workflow ist kurz davor, an Edit-Tools zu übergeben.

## Parameter

- `allowedPrompts` (array, optional): Prompts, die der Benutzer im Freigabedialog eingeben darf, um den Plan automatisch zu genehmigen oder zu verändern. Jedes Element spezifiziert eine begrenzte Berechtigung (zum Beispiel einen Operationsnamen und das Tool, auf das sie zutrifft). Nicht setzen, um den Standard-Freigabeablauf zu verwenden.

## Beispiele

### Beispiel 1: Standard-Einreichung

Nachdem der Assistent im Planmodus ein Authentifizierungs-Refactoring untersucht und die Plandatei auf die Festplatte geschrieben hat, ruft er `ExitPlanMode` ohne Argumente auf. Der Harness liest den Plan aus seinem kanonischen Ort, zeigt ihn dem Benutzer an und wartet auf Genehmigung oder Ablehnung.

### Beispiel 2: Vorab genehmigte Schnellaktionen

```
ExitPlanMode(allowedPrompts=[
  {"tool": "Bash", "prompt": "run tests"},
  {"tool": "Bash", "prompt": "install dependencies"}
])
```

Erlaubt dem Benutzer, für routinemäßige Folge-Befehle im Voraus die Erlaubnis zu erteilen, damit der Assistent bei der Implementierung nicht für jede Berechtigungsabfrage pausieren muss.

## Hinweise

- `ExitPlanMode` ist nur für umsetzungsartige Arbeit sinnvoll. Handelt es sich bei der Anfrage des Benutzers um eine Recherche- oder Erklärungsaufgabe ohne Dateiänderungen, antworten Sie direkt – routen Sie nicht über den Planmodus, nur um ihn zu verlassen.
- Der Plan muss bereits auf die Festplatte geschrieben sein, bevor dieses Tool aufgerufen wird. `ExitPlanMode` akzeptiert den Planinhalt nicht als Parameter; es liest vom Pfad, den der Harness erwartet.
- Lehnt der Benutzer den Plan ab, kehren Sie in den Planmodus zurück. Überarbeiten Sie basierend auf dem Feedback und reichen Sie erneut ein; beginnen Sie nicht mit Datei-Edits, solange der Plan nicht genehmigt ist.
- Die Genehmigung erteilt die Erlaubnis, den Planmodus zu verlassen und verändernde Tools (`Edit`, `Write`, `Bash` und so weiter) für den im Plan beschriebenen Umfang zu verwenden. Eine nachträgliche Ausweitung des Umfangs erfordert einen neuen Plan oder die ausdrückliche Zustimmung des Benutzers.
- Verwenden Sie `AskUserQuestion` nicht, um vor dem Aufruf dieses Tools "sieht dieser Plan gut aus?" zu fragen – die Plan-Genehmigung anzufordern ist genau das, was `ExitPlanMode` tut, und der Benutzer kann den Plan erst nach der Einreichung sehen.
- Halten Sie den Plan minimal und umsetzbar. Ein Reviewer sollte ihn in unter einer Minute überfliegen und genau verstehen können, was geändert wird.
- Erkennen Sie während der Implementierung, dass der Plan falsch war, stoppen Sie und melden Sie dies dem Benutzer, statt stillschweigend abzuweichen. Das erneute Betreten des Planmodus ist ein gültiger nächster Schritt.
