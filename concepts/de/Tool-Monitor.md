# Monitor

Startet einen Hintergrundmonitor, der Ereignisse von einem lang laufenden Skript streamt. Jede Zeile der Standardausgabe wird zu einer Benachrichtigung — weiterarbeiten, während Ereignisse im Chat eintreffen.

## Wann verwenden

- Verfolgen von Fehlern, Warnungen oder Absturzsignaturen in einer Logdatei während einer laufenden Bereitstellung
- Abfragen einer Remote-API, eines PR oder einer CI-Pipeline alle 30 Sekunden auf neue Statusereignisse
- Überwachen von Änderungen in einem Dateisystemverzeichnis oder in der Build-Ausgabe in Echtzeit
- Warten auf eine bestimmte Bedingung über viele Iterationen hinweg (z. B. ein Trainingsschritt-Meilenstein oder das Leeren einer Warteschlange)
- **Nicht** für einfaches "Warten bis fertig" — dafür `Bash` mit `run_in_background` verwenden; es sendet eine Fertigstellungsbenachrichtigung, wenn der Prozess beendet wird

## Aktivierung

- Standardmäßig deaktiviert (serverseitiges Feature-Flag).
- Nicht verfügbar auf Amazon Bedrock, Google Cloud und Microsoft Foundry.
- Deaktiviert, wenn `DISABLE_TELEMETRY` oder `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` gesetzt ist.
- Die WebSocket-Quelle erfordert Claude Code 2.1.195+.

## Parameter

- `command` (Zeichenkette, erforderlich): Der auszuführende Shell-Befehl oder das Skript. Jede in die Standardausgabe geschriebene Zeile wird zu einem eigenständigen Benachrichtigungsereignis. Der Monitor endet, wenn der Prozess beendet wird.
- `description` (Zeichenkette, erforderlich): Eine kurze, lesbare Bezeichnung, die in jeder Benachrichtigung angezeigt wird. Konkret sein — "Fehler in deploy.log" ist besser als "Logs überwachen". Dieses Label identifiziert, welcher Monitor ausgelöst hat.
- `timeout_ms` (Zahl, Standard `300000`, max `3600000`): Abbruchfrist in Millisekunden. Nach dieser Dauer wird der Prozess beendet. Wird ignoriert, wenn `persistent: true`.
- `persistent` (Boolean, Standard `false`): Bei `true` läuft der Monitor ohne Timeout für die gesamte Sitzung. Mit `TaskStop` explizit stoppen.

## Beispiele

### Beispiel 1: Logdatei auf Fehler und Abstürze überwachen

Dieses Beispiel deckt alle Endzustände ab: Erfolgsmarkierung, Traceback, gängige Fehlerschlüsselwörter, OOM-Abbruch und unerwarteten Prozessabbruch.

```bash
tail -F /var/log/deploy.log | grep -E --line-buffered \
  "deployed|Traceback|Error|FAILED|assert|Killed|OOM"
```

`grep --line-buffered` in jeder Pipe verwenden. Ohne diese Option puffert das Betriebssystem die Ausgabe in 4-KB-Blöcken, was zu Verzögerungen von Minuten führt. Das Alternierungsmuster deckt sowohl den Erfolgspfad (`deployed`) als auch Fehlerpfade (`Traceback`, `Error`, `FAILED`, `Killed`, `OOM`) ab. Ein Monitor, der nur auf die Erfolgsmarkierung wartet, bleibt bei einem Absturz stumm — Stille sieht identisch aus wie "läuft noch".

### Beispiel 2: Remote-API alle 30 Sekunden abfragen

```bash
while true; do
  curl -sf "https://api.example.com/status" || true
  sleep 30
done | grep --line-buffered -E "completed|failed|error"
```

`|| true` verhindert, dass ein vorübergehender Netzwerkfehler die Schleife beendet. Für Remote-APIs sind Abfrageintervalle von 30 Sekunden oder mehr empfehlenswert, um Rate-Limits zu vermeiden. Das Grep-Muster anpassen, um sowohl Erfolgs- als auch Fehlerantworten zu erfassen, damit API-seitige Fehler nicht durch Stille verdeckt werden.

## Hinweise

- **Immer `grep --line-buffered` in Pipes verwenden.** Ohne diese Option verzögert das Pipe-Buffering Ereignisse um Minuten, da das Betriebssystem die Ausgabe bis zum Füllen eines 4-KB-Blocks akkumuliert. `--line-buffered` erzwingt einen Flush nach jeder Zeile.
- **Der Filter muss sowohl Erfolgs- als auch Fehlersignaturen abdecken.** Ein Monitor, der nur auf die Erfolgsmarkierung wartet, bleibt bei Absturz, Hänger oder unerwartetem Beenden stumm. Das Alternierungsmuster erweitern: Neben dem Erfolgsschlüsselwort auch `Error`, `Traceback`, `FAILED`, `Killed`, `OOM` und ähnliche Endzustandsmarkierungen einschließen.
- **Abfrageintervalle: 30 Sekunden oder mehr für Remote-APIs.** Häufiges Abfragen externer Dienste riskiert Rate-Limit-Fehler oder Sperrungen. Für lokale Dateisystem- oder Prozessüberprüfungen sind 0,5–1 Sekunde angemessen.
- **`persistent: true` für sitzungsweite Monitore.** Der Standard-`timeout_ms` von 300.000 ms (5 Minuten) beendet den Prozess. Für Monitore, die bis zur expliziten Beendigung laufen sollen, `persistent: true` setzen und nach Abschluss `TaskStop` aufrufen.
- **Automatisches Stoppen bei Ereignisflut.** Jede Zeile der Standardausgabe ist eine Konversationsnachricht. Wenn der Filter zu breit ist und zu viele Ereignisse erzeugt, wird der Monitor automatisch gestoppt. Mit einem engeren `grep`-Muster neu starten. Zeilen, die innerhalb von 200 ms eintreffen, werden zu einer Benachrichtigung zusammengefasst.
