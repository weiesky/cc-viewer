# CronList

Listet alle Cron-Jobs auf, die in der aktuellen Sitzung via `CronCreate` geplant wurden. Gibt eine Zusammenfassung jedes aktiven Cron-Jobs zurück, einschliesslich `id`, Cron-Ausdruck, gekürztem `prompt`, `recurring`-Flag, `durable`-Flag und nächstem Ausführungszeitpunkt.

## Wann verwenden

- Um alle aktuell geplanten Jobs zu prüfen, bevor Änderungen vorgenommen oder die Sitzung beendet wird.
- Um die korrekte `id` eines Jobs zu finden, bevor `CronDelete` aufgerufen wird.
- Um zu debuggen, warum ein erwarteter Job nie ausgelöst wurde, indem seine Existenz und der nächste Ausführungszeitpunkt überprüft werden.
- Um zu bestätigen, dass ein einmaliger (nicht wiederkehrender) Job noch nicht ausgelöst wurde und noch aussteht.

## Parameter

Keine.

## Beispiele

### Beispiel 1: Alle geplanten Jobs prüfen

`CronList` ohne Argumente aufrufen, um die vollständige Liste aller aktiven Cron-Jobs abzurufen. Die Antwort enthält für jeden Job die `id`, den Cron-Ausdruck, eine gekürzte Version des `prompt`, ob er `recurring` (wiederkehrend) ist, ob er `durable` (persistent) ist und den nächsten geplanten Ausführungszeitpunkt.

### Beispiel 2: Die id eines bestimmten wiederkehrenden Tasks finden

Wenn mehrere Cron-Jobs erstellt wurden und einer davon gelöscht werden soll, zuerst `CronList` aufrufen. In der zurückgegebenen Liste nach dem Job suchen, dessen `prompt`-Zusammenfassung und Cron-Ausdruck zum Ziel-Task passen. Die `id` kopieren und an `CronDelete` übergeben.

## Hinweise

- Es werden nur Jobs der aktuellen Sitzung aufgelistet, es sei denn, sie wurden mit `durable: true` erstellt, wodurch sie Sitzungs-Neustarts überstehen.
- Das `prompt`-Feld in der Zusammenfassung ist gekürzt; es zeigt nur den Anfang des vollständigen Prompttexts, nicht den gesamten Inhalt.
- Einmalige Jobs (`recurring` ist `false`), die bereits ausgelöst wurden, werden automatisch gelöscht und erscheinen nicht mehr in der Liste.
