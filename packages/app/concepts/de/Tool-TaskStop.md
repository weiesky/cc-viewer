# TaskStop

Stoppt eine laufende Hintergrundaufgabe – einen Shell-Befehl, einen dispatchten Agenten oder eine Remote-Sitzung – per Laufzeit-Handle. Verwenden Sie es, um Ressourcen zurückzugewinnen, nicht mehr nützliche Arbeit abzubrechen oder sich zu erholen, wenn eine Aufgabe feststeckt.

## Wann verwenden

- Ein Hintergrund-Shell-Befehl läuft länger als erwartet und Sie benötigen sein Ergebnis nicht mehr.
- Ein lokaler Agent dreht sich in einer Schleife oder hängt und muss abgebrochen werden.
- Der Benutzer hat die Richtung geändert und die Hintergrundarbeit für die vorherige Richtung sollte aufgegeben werden.
- Eine Remote-Sitzung steht kurz vor einem Timeout oder hält eine Ressource, die Sie benötigen.
- Sie benötigen einen sauberen Stand, bevor Sie denselben Task neu ausführen.

Bevorzugen Sie, kurzlebige Hintergrundarbeit von selbst beenden zu lassen. `TaskStop` ist für Fälle, in denen weitere Ausführung keinen Wert hat oder aktiv schädlich ist.

## Parameter

- `task_id` (string, erforderlich): Das Laufzeit-Handle, das beim Start der Hintergrundaufgabe zurückgegeben wurde. Dies ist derselbe Bezeichner, den `TaskOutput` akzeptiert, nicht eine `taskId` aus der Aufgabenliste.

## Beispiele

### Beispiel 1

Einen ausreißenden Hintergrund-Shell-Befehl stoppen.

```
TaskStop(task_id: "bash_01HXYZ...")
```

Der Befehl erhält ein Terminate-Signal; bisher geschriebene gepufferte Ausgabe bleibt an ihrem Ausgabepfad lesbar.

### Beispiel 2

Einen dispatchten Agenten nach einer Benutzer-Kurskorrektur abbrechen.

```
TaskStop(task_id: "agent_01ABCD...")
```

## Hinweise

- `TaskStop` fordert eine Beendigung an; es garantiert keine unmittelbare Abschaltung. Wohlerzogene Aufgaben beenden sich zügig, aber ein Prozess, der blockierende E/A durchführt, kann einen Moment brauchen, um abzuwickeln.
- Das Stoppen einer Aufgabe löscht nicht deren Ausgabe. Für Hintergrund-Shell-Aufgaben bleibt die Ausgabedatei auf der Festplatte erhalten und ist weiterhin mit `Read` lesbar. Für Agenten und Sitzungen ist die vor dem Stopp erfasste Ausgabe über `TaskOutput` weiterhin zugänglich.
- Eine unbekannte `task_id` oder eine Aufgabe, die bereits beendet ist, gibt einen Fehler oder ein No-op zurück. Dies ist sicher – Sie können `TaskStop` defensiv aufrufen, ohne zuerst den Status zu prüfen.
- Wenn Sie beabsichtigen, dieselbe Arbeit neu zu starten, stoppen Sie die alte Aufgabe, bevor Sie die neue dispatchen, um zu vermeiden, dass zwei parallele Läufe auf gemeinsamen Ressourcen (Dateien, Ports, Datenbankzeilen) kollidieren.
- `TaskStop` beeinflusst keine Einträge in der Team-Aufgabenliste. Um eine verfolgte Aufgabe abzubrechen, aktualisieren Sie deren Status auf `deleted` mit `TaskUpdate`.
