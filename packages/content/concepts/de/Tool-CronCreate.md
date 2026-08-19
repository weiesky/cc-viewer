# CronCreate

Plant einen Prompt, der zu einem zukünftigen Zeitpunkt in die Warteschlange eingereiht wird — entweder einmalig oder wiederkehrend. Verwendet standardmäßige 5-Feld-Cron-Syntax in der lokalen Zeitzone des Benutzers, ohne Zeitzonenkonvertierung.

## Wann verwenden

- **Einmalige Erinnerungen**: Wenn der Benutzer zu einer bestimmten Uhrzeit erinnert werden möchte ("Erinnere mich morgen um 15 Uhr"). Mit `recurring: false` löscht sich der Task nach Ausführung automatisch.
- **Wiederkehrende Zeitpläne**: Wenn etwas regelmäßig ausgeführt werden soll ("jeden Wochentag um 9 Uhr", "alle 30 Minuten"). Der Standardwert `recurring: true` deckt diesen Fall ab.
- **Autonome Agent-Schleifen**: Für Workflows, die sich selbst in einem festen Rhythmus neu auslösen — z. B. tägliche Zusammenfassungen oder regelmäßige Statusprüfungen.
- **Persistente Tasks**: Wenn der Zeitplan einen Neustart überleben soll. Mit `durable: true` wird der Task in `.claude/scheduled_tasks.json` gespeichert.
- **Ungefähre Zeitangaben**: Wenn der Benutzer "gegen 9 Uhr" oder "stündlich" sagt, sollte ein versetzter Minutenwert gewählt werden (z. B. `57 8 * * *` oder `7 * * * *`), um eine Häufung zur vollen oder halben Stunde zu vermeiden.

## Parameter

- `cron` (string, erforderlich): 5-Feld-Cron-Ausdruck in der lokalen Zeitzone des Benutzers. Format: `Minute Stunde Tag Monat Wochentag`. Beispiel: `"0 9 * * 1-5"` bedeutet Montag–Freitag um 9:00 Uhr.
- `prompt` (string, erforderlich): Der Prompt-Text, der bei Auslösung in die Warteschlange eingereiht wird — die genaue Nachricht, die zum geplanten Zeitpunkt an die REPL gesendet wird.
- `recurring` (boolean, optional, Standard `true`): Bei `true` läuft der Job bei jeder passenden Cron-Periode und verfällt nach 7 Tagen automatisch. Bei `false` wird der Job genau einmal ausgeführt und dann gelöscht — für einmalige Erinnerungen.
- `durable` (boolean, optional, Standard `false`): Bei `false` lebt der Zeitplan nur im Arbeitsspeicher und geht bei Sitzungsende verloren. Bei `true` wird der Task in `.claude/scheduled_tasks.json` persistiert und überlebt Neustarts.

## Beispiele

### Beispiel 1: Einmalige Erinnerung

Benutzer sagt: "Erinnere mich morgen um 14:30 Uhr daran, den Wochenbericht zu senden." Angenommen, morgen ist der 21. April:

```json
{
  "cron": "30 14 21 4 *",
  "prompt": "Erinnerung: Jetzt den Wochenbericht senden.",
  "recurring": false,
  "durable": true
}
```

`recurring: false` stellt sicher, dass sich der Task nach Ausführung selbst löscht. `durable: true` bewahrt ihn über Neustarts hinweg.

### Beispiel 2: Wiederkehrender Wochentag-Morgen-Task

Benutzer sagt: "Fasse jeden Werktag morgens meine offenen GitHub-Issues zusammen."

```json
{
  "cron": "3 9 * * 1-5",
  "prompt": "Fasse alle mir zugewiesenen offenen GitHub-Issues zusammen.",
  "recurring": true,
  "durable": true
}
```

Minute `3` statt `0` vermeidet die Lastspitze zur vollen Stunde. Der Job verfällt nach 7 Tagen automatisch.

## Hinweise

- **7-Tage-Ablauf bei wiederkehrenden Tasks**: Wiederkehrende Jobs werden nach maximal 7 Tagen automatisch gelöscht. Für längere Zeitpläne muss der Task vor Ablauf neu erstellt werden.
- **Ausführung nur im Leerlauf**: `CronCreate` reiht den Prompt nur dann ein, wenn die REPL gerade keine andere Anfrage verarbeitet. Ist die REPL beim Auslösezeitpunkt beschäftigt, wartet der Prompt, bis die aktuelle Abfrage abgeschlossen ist.
- **:00 und :30 vermeiden**: Bei ungefähren Zeitangaben bewusst versetzte Minutenwerte wählen, um die Systemlast zu verteilen. Exakte :00/:30-Werte nur verwenden, wenn der Benutzer diese Minute ausdrücklich angibt.
- **Keine Zeitzonenkonvertierung**: Der Cron-Ausdruck wird direkt in der lokalen Zeitzone des Benutzers interpretiert. Eine Konvertierung in UTC oder eine andere Zone ist nicht erforderlich.
