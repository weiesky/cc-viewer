# AskUserQuestion

Zeigt dem Benutzer eine oder mehrere strukturierte Multiple-Choice-Fragen in der Chat-UI an, erfasst seine Auswahl und gibt sie an den Assistenten zurück – nützlich, um die Absicht ohne freies Hin und Her zu klären.

## Wann verwenden

- Eine Anfrage hat mehrere plausible Interpretationen und der Assistent benötigt eine Entscheidung des Benutzers, bevor er fortfahren kann.
- Der Benutzer muss zwischen konkreten Optionen wählen (Framework, Bibliothek, Dateipfad, Strategie), bei denen Freitextantworten fehleranfällig wären.
- Alternativen sollen im Vorschaubereich nebeneinander verglichen werden.
- Mehrere zusammenhängende Entscheidungen lassen sich in einem einzigen Prompt bündeln, um Hin und Her zu reduzieren.
- Ein Plan oder Tool-Aufruf hängt von einer Konfiguration ab, die der Benutzer noch nicht angegeben hat.

## Parameter

- `questions` (array, erforderlich): Eine bis vier Fragen, die gemeinsam in einem einzigen Prompt angezeigt werden. Jedes Frageobjekt enthält:
  - `question` (string, erforderlich): Der vollständige Fragetext, der mit einem Fragezeichen endet.
  - `header` (string, erforderlich): Ein kurzes Label (höchstens 12 Zeichen), das als Chip über der Frage gerendert wird.
  - `options` (array, erforderlich): Zwei bis vier Optionsobjekte. Jede Option hat ein `label` (1–5 Wörter), eine `description` und eine optionale `markdown`-Vorschau.
  - `multiSelect` (boolean, erforderlich): Bei `true` darf der Benutzer mehrere Optionen auswählen.

## Beispiele

### Beispiel 1: Ein einzelnes Framework auswählen

```
AskUserQuestion(questions=[{
  "header": "Test runner",
  "question": "Which test runner should I configure?",
  "multiSelect": false,
  "options": [
    {"label": "Vitest (Recommended)", "description": "Fast, Vite-native, Jest-compatible API"},
    {"label": "Jest",                  "description": "Mature, broadest plugin ecosystem"},
    {"label": "Node --test",           "description": "Zero dependencies, built in"}
  ]
}])
```

### Beispiel 2: Nebeneinander-Vorschau zweier Layouts

```
AskUserQuestion(questions=[{
  "header": "Layout",
  "question": "Which dashboard layout do you prefer?",
  "multiSelect": false,
  "options": [
    {"label": "Sidebar",  "description": "Nav on the left", "markdown": "```\n+------+---------+\n| NAV  | CONTENT |\n+------+---------+\n```"},
    {"label": "Top bar",  "description": "Nav across top",  "markdown": "```\n+-----------------+\n|       NAV       |\n+-----------------+\n|     CONTENT     |\n+-----------------+\n```"}
  ]
}])
```

## Hinweise

- Die UI fügt jeder Frage automatisch eine "Other"-Freitextoption hinzu. Fügen Sie keine eigene "Other"-, "None"- oder "Custom"-Option hinzu – diese dupliziert den eingebauten Ausstieg.
- Begrenzen Sie jeden Aufruf auf eine bis vier Fragen und jede Frage auf zwei bis vier Optionen. Das Überschreiten dieser Grenzen wird vom Harness abgelehnt.
- Wenn Sie eine bestimmte Option empfehlen, platzieren Sie diese an erster Stelle und hängen "(Recommended)" an das Label an, damit die UI den bevorzugten Pfad hervorhebt.
- Vorschauen über das `markdown`-Feld werden nur bei Einzelauswahl-Fragen unterstützt. Verwenden Sie diese für visuelle Artefakte wie ASCII-Layouts, Code-Snippets oder Konfigurations-Diffs – nicht für einfache Präferenzfragen, bei denen Label plus Beschreibung genügen.
- Sobald irgendeine Option einer Frage einen `markdown`-Wert hat, wechselt die UI in ein Nebeneinander-Layout mit der Optionsliste links und der Vorschau rechts.
- Verwenden Sie `AskUserQuestion` nicht, um "sieht dieser Plan gut aus?" zu fragen – rufen Sie stattdessen `ExitPlanMode` auf, das genau für Planfreigaben existiert. Im Planmodus sollten Sie zudem vermeiden, im Fragetext auf "den Plan" zu verweisen, da der Plan für den Benutzer erst nach `ExitPlanMode` sichtbar ist.
- Verwenden Sie dieses Tool nicht, um sensible oder Freitext-Eingaben wie API-Schlüssel oder Passwörter anzufordern. Fragen Sie stattdessen im Chat.
