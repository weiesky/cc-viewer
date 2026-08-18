# EndConversation

Beendet die aktuelle Unterhaltung und verhindert, dass weitere Nachrichten gesendet werden.

## Wann verwenden

- Nur bei anhaltendem Missbrauch durch den Benutzer oder wenn der Benutzer ausdrücklich eine Demonstration dieses Tools anfordert.

Dies ist eine Aktion des letzten Auswegs: Die eigenen Regeln des Tools verlangen, den Benutzer vor der Verwendung zu warnen und zu bestätigen, und es darf niemals in Situationen mit Selbstverletzung oder Schaden verwendet werden.

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
