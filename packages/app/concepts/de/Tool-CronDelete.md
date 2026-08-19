# CronDelete

Bricht einen zuvor mit `CronCreate` geplanten Cron-Job ab. Entfernt ihn sofort aus dem In-Memory-Sitzungsspeicher. Hat keine Auswirkung, wenn der Job bereits automatisch gelöscht wurde (Einmal-Jobs werden nach der Ausführung entfernt, wiederkehrende Jobs laufen nach 7 Tagen ab).

## Wann verwenden

- Ein Benutzer bittet darum, einen wiederkehrenden geplanten Task vor dem automatischen 7-Tage-Ablauf zu stoppen.
- Ein Einmal-Job wird nicht mehr benötigt und soll vor der Ausführung abgebrochen werden.
- Der Zeitplan eines bestehenden Jobs muss geändert werden — mit `CronDelete` löschen, dann mit `CronCreate` und dem neuen Ausdruck neu erstellen.
- Mehrere veraltete Jobs bereinigen, um den Sitzungsspeicher sauber zu halten.

## Parameter

- `id` (string, erforderlich): Die Job-ID, die von `CronCreate` bei der Erstellung des Jobs zurückgegeben wurde. Dieser Wert muss exakt übereinstimmen; eine unscharfe oder namensbasierte Suche wird nicht unterstützt.

## Beispiele

### Beispiel 1: Einen laufenden wiederkehrenden Job abbrechen

Ein wiederkehrender Job mit der ID `"cron_abc123"` wurde zuvor erstellt. Der Benutzer möchte ihn stoppen.

```
CronDelete({ id: "cron_abc123" })
```

Der Job wird aus dem Sitzungsspeicher entfernt und wird nicht mehr ausgeführt.

### Beispiel 2: Einen veralteten Einmal-Job vor der Ausführung entfernen

Ein Einmal-Job mit der ID `"cron_xyz789"` wurde für die Ausführung in 30 Minuten geplant, aber der Benutzer hat entschieden, dass er nicht mehr benötigt wird.

```
CronDelete({ id: "cron_xyz789" })
```

Der Job wird abgebrochen. Zum ursprünglichen Auslösezeitpunkt wird keine Aktion ausgeführt.

## Hinweise

- Die `id` muss aus dem Rückgabewert von `CronCreate` bezogen werden. Es gibt keine Möglichkeit, einen Job anhand von Beschreibung oder Callback zu suchen — speichern Sie die ID, falls Sie den Job später abbrechen müssen.
- Wenn der Job bereits automatisch gelöscht wurde (als Einmal-Job ausgeführt oder nach 7-tägigem wiederkehrendem Ablauf), ist der Aufruf von `CronDelete` mit dieser ID eine No-Op-Operation und erzeugt keinen Fehler.
- `CronDelete` wirkt sich nur auf die aktuelle In-Memory-Sitzung aus. Wenn die Laufzeitumgebung den Cron-Status nicht über Neustarts hinweg persistiert, gehen geplante Jobs nach einem Neustart verloren, unabhängig davon, ob `CronDelete` aufgerufen wurde.
- Es gibt keinen Massenloschvorgang; jeder Job muss einzeln mit seiner eigenen `id` abgebrochen werden.
