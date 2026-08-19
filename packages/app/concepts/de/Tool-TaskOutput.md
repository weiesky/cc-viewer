# TaskOutput

Holt die angesammelte Ausgabe einer laufenden oder abgeschlossenen Hintergrundaufgabe ab – eines Hintergrund-Shell-Befehls, eines lokalen Agenten oder einer Remote-Sitzung. Verwenden Sie es, wenn Sie inspizieren möchten, was eine langlaufende Aufgabe bisher produziert hat.

## Wann verwenden

- Eine Remote-Sitzung (zum Beispiel eine Cloud-Sandbox) läuft und Sie benötigen deren stdout.
- Ein lokaler Agent wurde im Hintergrund gestartet und Sie möchten Teilfortschritt, bevor er zurückkehrt.
- Ein Hintergrund-Shell-Befehl läuft schon lange genug, dass Sie nach ihm sehen möchten, ohne ihn zu stoppen.
- Sie müssen bestätigen, dass eine Hintergrundaufgabe tatsächlich Fortschritt macht, bevor Sie länger warten oder `TaskStop` aufrufen.

Greifen Sie nicht reflexhaft zu `TaskOutput`. Für die meiste Hintergrundarbeit gibt es einen direkteren Weg – siehe die Hinweise unten.

## Parameter

- `task_id` (string, erforderlich): Der Aufgabenbezeichner, der beim Start der Hintergrundarbeit zurückgegeben wurde. Nicht dasselbe wie eine `taskId` aus der Aufgabenliste; dies ist das Laufzeit-Handle für die konkrete Ausführung.
- `block` (boolean, optional): Bei `true` (Standard) warten, bis die Aufgabe neue Ausgabe produziert oder beendet wird, bevor zurückgekehrt wird. Bei `false` sofort mit dem Gepufferten zurückkehren.
- `timeout` (number, optional): Maximale Millisekunden zum Blockieren vor der Rückkehr. Nur relevant, wenn `block` `true` ist. Standard `30000`, Maximum `600000`.

## Beispiele

### Beispiel 1

Ohne Blockieren einen Blick auf eine Remote-Sitzung werfen.

```
TaskOutput(task_id: "sess_01HXYZ...", block: false)
```

Gibt zurück, was stdout/stderr produziert hat, seit die Aufgabe gestartet wurde (oder seit Ihrem letzten `TaskOutput`-Aufruf, abhängig von der Laufzeitumgebung).

### Beispiel 2

Kurz darauf warten, dass ein lokaler Agent mehr Ausgabe produziert.

```
TaskOutput(
  task_id: "agent_01ABCD...",
  block: true,
  timeout: 10000
)
```

## Hinweise

- Hintergrund-Bash-Befehle: `TaskOutput` ist für diesen Anwendungsfall faktisch veraltet. Wenn Sie eine Hintergrund-Shell-Aufgabe starten, enthält das Ergebnis bereits den Pfad zu ihrer Ausgabedatei – lesen Sie diesen Pfad direkt mit dem `Read`-Tool. `Read` bietet Ihnen wahlfreien Zugriff, Zeilen-Offsets und eine stabile Ansicht; `TaskOutput` nicht.
- Lokale Agenten (das im Hintergrund dispatchte `Agent`-Tool): Wenn der Agent fertig ist, enthält das Ergebnis des `Agent`-Tools bereits seine endgültige Antwort. Nutzen Sie diese direkt. Lesen Sie nicht die symbolisch verknüpfte Transkript-Datei – sie enthält den vollen Tool-Call-Stream und wird das Kontextfenster überlaufen.
- Remote-Sitzungen: `TaskOutput` ist die korrekte und oft einzige Möglichkeit, Ausgabe zurückzustreamen. Bevorzugen Sie `block: true` mit einem moderaten `timeout` gegenüber engen Polling-Schleifen.
- Eine unbekannte `task_id` oder eine Aufgabe, deren Ausgabe garbage-collected wurde, gibt einen Fehler zurück. Starten Sie die Arbeit erneut, wenn Sie sie noch brauchen.
- `TaskOutput` stoppt die Aufgabe nicht. Verwenden Sie `TaskStop`, um zu beenden.
