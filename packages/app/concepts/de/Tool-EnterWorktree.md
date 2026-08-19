# EnterWorktree

Erstellt einen isolierten Git-Worktree auf einem neuen Branch oder wechselt die Sitzung in einen bestehenden Worktree des aktuellen Repositorys, sodass parallele oder experimentelle Arbeit fortschreiten kann, ohne den primären Checkout zu berühren.

## Wann verwenden

- Der Benutzer sagt ausdrücklich "worktree" – zum Beispiel "einen worktree starten", "einen worktree erstellen" oder "in einem worktree arbeiten".
- Projektanweisungen in `CLAUDE.md` oder persistenter Speicher weisen Sie an, einen Worktree für die aktuelle Aufgabe zu verwenden.
- Sie möchten eine Aufgabe fortsetzen, die zuvor als Worktree eingerichtet wurde (`path` übergeben, um erneut einzutreten).
- Mehrere experimentelle Branches müssen auf der Festplatte koexistieren, ohne ständiges Checkout-Hin-und-Her.
- Eine langlaufende Aufgabe soll von unbeteiligten Edits im Haupt-Working-Tree isoliert werden.

## Parameter

- `name` (string, optional): Ein Name für ein neues Worktree-Verzeichnis. Jedes durch `/` getrennte Segment darf nur Buchstaben, Ziffern, Punkte, Unterstriche und Bindestriche enthalten; die gesamte Zeichenkette ist auf 64 Zeichen begrenzt. Wenn weder angegeben noch `path` gesetzt ist, wird ein zufälliger Name generiert. Schließt `path` aus.
- `path` (string, optional): Der Dateisystempfad eines bestehenden Worktrees des aktuellen Repositorys, in den gewechselt werden soll. Muss in `git worktree list` für dieses Repo auftauchen; Pfade, die keine registrierten Worktrees des aktuellen Repos sind, werden abgelehnt. Schließt `name` aus.

## Beispiele

### Beispiel 1: Neuen Worktree mit beschreibendem Namen erstellen

```
EnterWorktree(name="feat/okta-sso")
```

Erstellt `.claude/worktrees/feat/okta-sso` auf einem neuen Branch basierend auf `HEAD` und wechselt dann das Arbeitsverzeichnis der Sitzung hinein. Alle nachfolgenden Datei-Edits und Shell-Befehle operieren innerhalb dieses Worktrees, bis Sie ihn verlassen.

### Beispiel 2: In einen bestehenden Worktree zurückkehren

```
EnterWorktree(path="/Users/me/repo/.claude/worktrees/feat/okta-sso")
```

Setzt die Arbeit in einem zuvor erstellten Worktree fort. Da Sie ihn über `path` betreten haben, löscht `ExitWorktree` ihn nicht automatisch – das Verlassen mit `action: "keep"` kehrt einfach zum ursprünglichen Verzeichnis zurück.

## Hinweise

- Rufen Sie `EnterWorktree` nicht auf, sofern der Benutzer es nicht ausdrücklich verlangt hat oder Projektanweisungen es vorschreiben. Gewöhnliche Branch-Wechsel oder Bugfix-Anfragen sollten normale Git-Befehle verwenden, keine Worktrees.
- Innerhalb eines Git-Repositorys aufgerufen, legt das Tool einen Worktree unter `.claude/worktrees/` an und registriert einen neuen Branch basierend auf `HEAD`. Außerhalb eines Git-Repositorys delegiert es an konfigurierte `WorktreeCreate` / `WorktreeRemove` Hooks in `settings.json` für VCS-agnostische Isolation.
- Nur eine Worktree-Sitzung ist gleichzeitig aktiv. Das Tool verweigert die Ausführung, wenn Sie sich bereits in einer Worktree-Sitzung befinden; beenden Sie zuerst mit `ExitWorktree`.
- Verwenden Sie `ExitWorktree`, um mitten in der Sitzung zu verlassen. Wenn die Sitzung endet, während Sie sich noch in einem neu erstellten Worktree befinden, wird der Benutzer aufgefordert, ihn zu behalten oder zu entfernen.
- Über `path` betretene Worktrees gelten als extern – `ExitWorktree` mit `action: "remove"` löscht diese nicht. Das ist eine Sicherheitsschiene zum Schutz von Worktrees, die der Benutzer manuell verwaltet.
- Ein neuer Worktree erbt den Inhalt des aktuellen Branches, hat aber ein eigenständiges Arbeitsverzeichnis und einen eigenen Index. Staged und unstaged Änderungen im Haupt-Checkout sind innerhalb des Worktrees nicht sichtbar.
- Namenstipp: Mit der Art der Arbeit als Präfix (`feat/`, `fix/`, `spike/`) versehen, damit sich mehrere gleichzeitige Worktrees in `git worktree list` gut unterscheiden lassen.
