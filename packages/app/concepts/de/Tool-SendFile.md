# SendFile

Sendet eine oder mehrere Dateien an eine andere Claude Code-Sitzung – einen von `ListAgents` aufgeführten Peer oder eine explizite Sitzungsadresse.

## Wann verwenden

- Eine Peer-Sitzung benötigt eine Datei aus Ihrem Arbeitsverzeichnis (einen Bericht, einen Patch, ein Fixture), um ihre eigene Aufgabe fortzusetzen.
- Sie koordinieren Arbeit über Sitzungen hinweg und möchten Artefakte übergeben, nicht nur Text (für Text `SendMessage` verwenden).

## Aktivierung

- Der sitzungsübergreifende Dateitransfer muss in der Sitzung verfügbar sein; ist er es nicht, schlägt die Validierung fehl mit "Cross-session file transfer is not available in this session."
- Unterliegt denselben Bedingungen für sitzungsübergreifendes Messaging wie `ListAgents` (serverseitige Feature-Flags, standardmäßig deaktiviert).

## Parameter

- `to` (string, erforderlich): Empfänger – ein Peer-Sitzungsname aus `ListAgents` oder eine explizite `uds:<socket>`- bzw. `bridge:<session id>`-Adresse.
- `files` (array of strings, erforderlich): Zu sendende Dateipfade (absolut oder relativ zum cwd). Übergeben Sie immer ein Array, auch bei einer einzelnen Datei. 1–16 Dateien, höchstens 30 MiB pro Datei.
- `message` (string, optional): Kurze Nachricht, die zusammen mit den Dateien zugestellt wird.

## Beispiele

### Beispiel 1: Einen Bericht an eine Peer-Sitzung senden

```
SendFile(
  to="teammate-a",
  files=["./dist/report.html"],
  message="The analysis you asked for"
)
```

## Hinweise

- Übertragungen an entfernte Rechner können eine zusätzliche Freigabe erfordern.
- Das Lesen des Dateiinhalts ist Teil des Sendevorgangs – verweigert, wenn das Lesen von Dateien durch Berechtigungsregeln deaktiviert ist.
