# ReadNotifications

Legge le notifiche in coda per l'assistente nella sessione corrente — attività GitHub sulle PR sottoscritte (`github_webhook`), attivazioni di trigger pianificati (`trigger_fire`) e messaggi in arrivo da altre sessioni Claude (`mcp_send_message`).

## Quando usare

- Sei stato notificato che è successo qualcosa — una PR sottoscritta è stata aggiornata, un trigger pianificato si è attivato, un'altra sessione ti ha scritto un messaggio — e hai bisogno del payload effettivo.
- Svuotare un arretrato: i lotti grandi vengono restituiti in parti, quindi continua a chiamare finché il risultato non riporta 0 `remaining`.

## Parametri

Questo tool non accetta parametri.

## Esempi

### Esempio 1: Svuotare le notifiche in attesa

```
ReadNotifications()
```

Restituisce le notifiche in coda partendo dalle più vecchie. Il risultato include un conteggio `remaining` delle notifiche ancora in coda dopo questo svuotamento — chiama di nuovo il tool per leggerle.

## Note

- Gli svuotamenti hanno un budget di dimensione: una chiamata successiva restituisce il resto della STESSA coda (più qualsiasi cosa arrivata nel frattempo), non solo i nuovi arrivi. Itera finché `remaining` è 0.
- Le notifiche provengono dai webhook GitHub sulle PR sottoscritte, dai trigger pianificati e dai messaggi di altre sessioni Claude; non c'è alcun parametro di filtro nella versione corrente.
