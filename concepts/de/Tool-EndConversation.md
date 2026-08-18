# EndConversation

Beendet die aktuelle Unterhaltung und verhindert, dass weitere Nachrichten gesendet werden.

## Wann verwenden

- Nur bei anhaltendem Missbrauch durch den Benutzer oder wenn der Benutzer ausdrücklich eine Demonstration dieses Tools anfordert.

Dies ist eine Aktion des letzten Auswegs: Die eigenen Regeln des Tools verlangen, den Benutzer vor der Verwendung zu warnen und zu bestätigen, und es darf niemals in Situationen mit Selbstverletzung oder Schaden verwendet werden.

## Aktivierung

- Erfordert Claude Code 2.1.213+ und ein Modell der Familie Opus 4.8 / Sonnet 5 / Fable 5 oder neuer.
- Nur interaktive Terminal-Sitzungen – niemals im `--bare`-Modus und niemals für Subagenten verfügbar.
- Nicht verfügbar auf Amazon Bedrock, Claude Platform on AWS, Vertex AI, Microsoft Foundry oder Cloud-Gateways.
- Erfordert ein serverseitiges Feature-Flag – die meisten Sitzungen bieten dieses Tool nicht an.

## Parameter

Dieses Tool nimmt keine Parameter entgegen.

## Beispiele

### Beispiel 1: Die Unterhaltung beenden

```
EndConversation()
```

Der Ablauf ist zweistufig: Der erste Aufruf gibt eine Reflexionsnachricht zurück; ein zweiter Aufruf unmittelbar danach beendet die Unterhaltung tatsächlich (`ended: true`).

## Hinweise

- Stark eingeschränkt: erfordert ein unterstütztes Modell, den CLI-Einstiegspunkt und ein serverseitiges Feature-Flag – die meisten Sitzungen bieten dieses Tool nicht an.
- Sobald beendet, können keine weiteren Nachrichten in der Unterhaltung gesendet werden.
