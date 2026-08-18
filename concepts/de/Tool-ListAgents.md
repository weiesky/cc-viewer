# ListAgents

Listet die Agenten auf, an die Sie `SendMessage` senden können: In-Process-Subagenten, die Sie gestartet haben, andere lokale Claude-Sitzungen auf diesem Rechner, Ihre Cloud-Sitzungen (wenn diese Sitzung Cloud-Zugriff hat) und – wenn Remote Control verbunden ist – die übrigen Sitzungen Ihres Kontos. Jede Zeile ist nach Art gekennzeichnet.

## Wann verwenden

- Sie benötigen den exakten Namen einer Peer-Sitzung oder eines Subagenten, bevor Sie ihm eine Nachricht senden.
- Sie möchten sehen, welche Sitzungen von dieser aus derzeit erreichbar sind.

## Parameter

- `channel` (string, optional): In diesem Build nicht verfügbar; nicht setzen.
- `q` (string, optional): In diesem Build nicht verfügbar; nicht setzen.

## Beispiele

### Beispiel 1: Erreichbare Agenten auflisten

```
ListAgents()
```

Jede Zeile gibt einen Namen aus – dieser Name ist die Adresse. Senden Sie mit `SendMessage({to: "<name>", message: "..."})` und kopieren Sie den Namen exakt wie ausgegeben. Hängen Sie das ` [ref]` einer Zeile nur an, wenn der bloße Name mehrdeutig ist (zwei Zeilen teilen ihn, oder ein Fehler fordert Sie zur Eindeutigmachung auf).

## Hinweise

- Schreibgeschützt und nebenläufigkeitssicher.
- Eine Cloud-Sitzung empfängt Ihre Nachricht, kann aber noch nicht antworten – lesen Sie ihre Antwort in ihrem eigenen Transkript.
- Die Verfügbarkeit hängt von der Sitzungskonfiguration ab (sitzungsübergreifendes Messaging ist ein durch Feature-Flags freigeschaltetes Feature).
