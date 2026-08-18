# ReadNotifications

Liest Benachrichtigungen, die in der aktuellen Sitzung für den Assistenten in der Warteschlange stehen – GitHub-Aktivität auf abonnierten PRs (`github_webhook`), Auslösungen geplanter Trigger (`trigger_fire`) und Nachrichten, die aus anderen Claude-Sitzungen eintreffen (`mcp_send_message`).

## Wann verwenden

- Sie wurden benachrichtigt, dass etwas passiert ist – ein abonnierter PR wurde aktualisiert, ein geplanter Trigger wurde ausgelöst, eine andere Sitzung hat Ihnen geschrieben – und benötigen den tatsächlichen Payload.
- Abarbeiten eines Rückstands: Große Chargen werden in Teilen zurückgegeben, rufen Sie das Tool daher so lange auf, bis das Ergebnis 0 `remaining` meldet.

## Parameter

Dieses Tool nimmt keine Parameter entgegen.

## Beispiele

### Beispiel 1: Ausstehende Benachrichtigungen abrufen

```
ReadNotifications()
```

Gibt die in der Warteschlange stehenden Benachrichtigungen zurück, die ältesten zuerst. Das Ergebnis enthält einen `remaining`-Zähler für Benachrichtigungen, die nach diesem Abruf noch in der Warteschlange stehen – rufen Sie das Tool erneut auf, um sie zu lesen.

## Hinweise

- Abrufe sind größenbeschränkt: Ein Folgeaufruf gibt den Rest DERSELBEN Warteschlange zurück (plus alles neu Eingetroffene), nicht nur neue Einträge. Wiederholen Sie den Aufruf, bis `remaining` 0 ist.
- Benachrichtigungen stammen von GitHub-Webhooks auf abonnierten PRs, geplanten Triggern und Nachrichten aus anderen Claude-Sitzungen; in der aktuellen Version gibt es keinen Filterparameter.
