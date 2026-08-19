# Bash

Führt einen Shell-Befehl in einem persistenten Arbeitsverzeichnis aus und gibt dessen stdout/stderr zurück. Am besten reserviert für Operationen, die kein dediziertes Claude-Code-Tool abbilden kann, wie das Ausführen von git, npm, docker oder Build-Skripten.

## Wann verwenden

- Ausführen von Git-Operationen (`git status`, `git diff`, `git commit`, `gh pr create`)
- Ausführen von Paketmanagern und Build-Werkzeugen (`npm install`, `npm run build`, `pytest`, `cargo build`)
- Starten langlaufender Prozesse (Entwicklungsserver, Watcher) im Hintergrund mit `run_in_background`
- Aufrufen domänenspezifischer CLIs (`docker`, `terraform`, `kubectl`, `gh`), die kein eingebautes Äquivalent haben
- Verketten abhängiger Schritte mit `&&`, wenn die Reihenfolge relevant ist

## Parameter

- `command` (string, erforderlich): Der exakte Shell-Befehl, der ausgeführt werden soll.
- `description` (string, erforderlich): Eine kurze, aktive Zusammenfassung (5–10 Wörter für einfache Befehle; mehr Kontext für verkettete oder unübliche).
- `timeout` (number, optional): Timeout in Millisekunden, bis zu `600000` (10 Minuten). Standard ist `120000` (2 Minuten).
- `run_in_background` (boolean, optional): Bei `true` läuft der Befehl abgekoppelt, und Sie erhalten bei Abschluss eine Benachrichtigung. Hängen Sie selbst kein `&` an.

## Beispiele

### Beispiel 1: Repo-Zustand vor dem Committen prüfen
`git status` und `git diff --stat` als zwei parallele `Bash`-Aufrufe in derselben Nachricht absetzen, um schnell Kontext zu sammeln, und den Commit dann im Folgeaufruf zusammenstellen.

### Beispiel 2: Abhängige Build-Schritte verketten
Einen einzigen Aufruf wie `npm ci && npm run build && npm test` verwenden, damit jeder Schritt nur nach erfolgreichem Abschluss des vorherigen ausgeführt wird. `;` nur dann nutzen, wenn spätere Schritte auch nach Fehlern laufen sollen.

### Beispiel 3: Langlaufender Entwicklungsserver
`npm run dev` mit `run_in_background: true` aufrufen. Sie werden beim Beenden benachrichtigt. Kein Polling mit `sleep`-Schleifen; Fehler diagnostizieren statt blind zu wiederholen.

## Hinweise

- Das Arbeitsverzeichnis bleibt zwischen Aufrufen erhalten, der Shell-Zustand (exportierte Variablen, Shell-Funktionen, Aliase) jedoch nicht. Bevorzugen Sie absolute Pfade und vermeiden Sie `cd`, sofern der Benutzer es nicht verlangt.
- Bevorzugen Sie dedizierte Tools gegenüber verketteten Shell-Äquivalenten: `Glob` statt `find`/`ls`, `Grep` statt `grep`/`rg`, `Read` statt `cat`/`head`/`tail`, `Edit` statt `sed`/`awk`, `Write` statt `echo >` oder Here-Documents, sowie reinen Assistententext statt `echo`/`printf` für benutzerseitige Ausgaben.
- Setzen Sie jeden Pfad mit Leerzeichen in doppelte Anführungszeichen (zum Beispiel `"/Users/me/My Project/file.txt"`).
- Für unabhängige Befehle mehrere `Bash`-Tool-Aufrufe parallel in einer einzigen Nachricht absetzen. Nur mit `&&` verketten, wenn ein Befehl vom anderen abhängt.
- Ausgaben über 30000 Zeichen werden gekürzt. Beim Erfassen großer Logs in eine Datei umleiten und anschließend mit dem `Read`-Tool lesen.
- Nie interaktive Flags wie `git rebase -i` oder `git add -i` verwenden; diese können über dieses Tool keine Eingaben entgegennehmen.
- Überspringen Sie keine Git-Hooks (`--no-verify`, `--no-gpg-sign`) und führen Sie keine destruktiven Operationen (`reset --hard`, `push --force`, `clean -f`) durch, sofern der Benutzer sie nicht ausdrücklich verlangt.
