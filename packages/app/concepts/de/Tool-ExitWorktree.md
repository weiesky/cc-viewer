# ExitWorktree

Beendet eine zuvor von `EnterWorktree` erstellte Worktree-Sitzung und kehrt zum ursprünglichen Arbeitsverzeichnis zurück. Dieses Tool wirkt ausschließlich auf Worktrees, die in der aktuellen Sitzung von `EnterWorktree` erstellt wurden. Ist keine solche Sitzung aktiv, ist der Aufruf wirkungslos.

## Wann verwenden

- Die Arbeit in einem isolierten Worktree ist abgeschlossen und Sie möchten zum Hauptarbeitsverzeichnis zurückkehren.
- Eine Aufgabe in einem Feature-Branch-Worktree ist erledigt und nach dem Mergen soll der Branch mitsamt Verzeichnis bereinigt werden.
- Der Worktree soll für eine spätere Nutzung erhalten bleiben, ohne dass dabei etwas gelöscht wird.
- Ein experimenteller oder temporärer Branch soll verworfen werden, ohne Artefakte auf der Festplatte zu hinterlassen.
- Vor dem Start einer neuen `EnterWorktree`-Sitzung muss die aktuelle zuerst beendet werden.

## Parameter

- `action` (Zeichenkette, erforderlich): `"keep"` belässt das Worktree-Verzeichnis und den Branch auf der Festplatte, sodass später zurückgekehrt werden kann; `"remove"` löscht sowohl das Verzeichnis als auch den Branch für einen sauberen Abschluss.
- `discard_changes` (Boolescher Wert, optional, Standard `false`): Nur relevant, wenn `action` den Wert `"remove"` hat. Enthält der Worktree nicht committete Dateien oder Commits, die nicht im ursprünglichen Branch vorhanden sind, verweigert das Tool das Entfernen, sofern `discard_changes` nicht auf `true` gesetzt wird. Die Fehlerantwort listet die betreffenden Änderungen auf, damit vor einem erneuten Aufruf die Bestätigung des Benutzers eingeholt werden kann.

## Beispiele

### Beispiel 1: Sauberer Abschluss nach dem Mergen von Änderungen

Nach Abschluss der Arbeit im Worktree und dem Mergen des Branches in den Hauptbranch wird `ExitWorktree` mit `action: "remove"` aufgerufen. Das Worktree-Verzeichnis und der Branch werden gelöscht, und die Sitzung kehrt zum ursprünglichen Arbeitsverzeichnis zurück.

```
ExitWorktree(action: "remove")
```

### Beispiel 2: Verwerfen eines temporären Worktrees mit nicht committeten experimentellen Änderungen

Enthält ein Worktree experimentelle, nicht committete Änderungen, die vollständig verworfen werden sollen, wird zunächst `action: "remove"` versucht. Das Tool verweigert den Vorgang und listet die nicht committeten Änderungen auf. Nach Bestätigung durch den Benutzer wird mit `discard_changes: true` erneut aufgerufen.

```
ExitWorktree(action: "remove", discard_changes: true)
```

## Hinweise

- Dieses Tool wirkt ausschließlich auf Worktrees, die in der aktuellen Sitzung von `EnterWorktree` erstellt wurden. Worktrees, die mit `git worktree add` angelegt wurden, Worktrees aus früheren Sitzungen oder das normale Arbeitsverzeichnis, falls `EnterWorktree` nie aufgerufen wurde, werden nicht berührt — in diesen Fällen ist der Aufruf wirkungslos.
- `action: "remove"` wird verweigert, wenn der Worktree nicht committete Änderungen oder Commits enthält, die nicht im ursprünglichen Branch vorhanden sind, sofern `discard_changes: true` nicht explizit angegeben wird. Da die Daten nicht wiederhergestellt werden können, ist vor dem Setzen von `discard_changes: true` stets die Bestätigung des Benutzers einzuholen.
- Ist eine tmux-Sitzung an den Worktree gebunden, wird sie bei `remove` beendet; bei `keep` läuft sie weiter, und ihr Name wird zurückgegeben, damit der Benutzer sich später wieder verbinden kann.
- Nach Abschluss von `ExitWorktree` kann `EnterWorktree` erneut aufgerufen werden, um eine neue Worktree-Sitzung zu starten.
