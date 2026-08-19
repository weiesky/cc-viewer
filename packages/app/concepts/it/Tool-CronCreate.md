# CronCreate

Pianifica un prompt da mettere in coda a un momento futuro, sia come esecuzione unica sia ricorrente. Utilizza la sintassi cron standard a 5 campi nel fuso orario locale dell'utente, senza necessità di conversione del fuso orario.

## Quando usare

- **Promemoria una tantum**: Quando l'utente vuole essere ricordato a un orario specifico ("ricordami domani alle 15"). Con `recurring: false`, il task si elimina automaticamente dopo l'esecuzione.
- **Pianificazioni ricorrenti**: Quando qualcosa deve avvenire ripetutamente ("ogni giorno feriale alle 9", "ogni 30 minuti"). Il valore predefinito `recurring: true` copre questo caso.
- **Loop di agente autonomo**: Per costruire flussi di lavoro che si ri-attivano autonomamente secondo un calendario — ad esempio un riepilogo giornaliero o un controllo periodico dello stato.
- **Task persistenti**: Quando la pianificazione deve sopravvivere al riavvio della sessione. Con `durable: true`, il task viene salvato in `.claude/scheduled_tasks.json`.
- **Richieste di orario approssimativo**: Quando l'utente dice "verso le 9" o "ogni ora", scegliere un valore di minuto sfalsato (es. `57 8 * * *` o `7 * * * *`) per evitare che molti utenti si concentrino su :00 o :30.

## Parametri

- `cron` (string, obbligatorio): Espressione cron a 5 campi nel fuso orario locale dell'utente. Formato: `minuto ora giorno-del-mese mese giorno-della-settimana`. Esempio: `"0 9 * * 1-5"` significa lunedì–venerdì alle 9:00.
- `prompt` (string, obbligatorio): Il testo del prompt da mettere in coda quando il cron si attiva — il messaggio esatto che verrà inviato al REPL all'orario pianificato.
- `recurring` (boolean, opzionale, predefinito `true`): Con `true`, il job si esegue a ogni intervallo cron corrispondente e scade automaticamente dopo 7 giorni. Con `false`, il job si esegue esattamente una volta e viene poi eliminato — per promemoria una tantum.
- `durable` (boolean, opzionale, predefinito `false`): Con `false`, la pianificazione vive solo in memoria e va persa alla fine della sessione. Con `true`, il task viene persistito in `.claude/scheduled_tasks.json` e sopravvive ai riavvii.

## Esempi

### Esempio 1: promemoria una tantum

L'utente dice: "Ricordami domani alle 14:30 di inviare il report settimanale." Supponendo che domani sia il 21 aprile:

```json
{
  "cron": "30 14 21 4 *",
  "prompt": "Promemoria: invia il report settimanale adesso.",
  "recurring": false,
  "durable": true
}
```

`recurring: false` garantisce che il task si elimini dopo l'esecuzione. `durable: true` lo mantiene attraverso eventuali riavvii precedenti.

### Esempio 2: task mattutino ricorrente nei giorni feriali

L'utente dice: "Ogni mattina feriale, riepiloga le mie issue aperte su GitHub."

```json
{
  "cron": "3 9 * * 1-5",
  "prompt": "Riepiloga tutte le issue aperte su GitHub assegnate a me.",
  "recurring": true,
  "durable": true
}
```

Il minuto `3` al posto di `0` evita il picco di carico all'ora esatta. Il job scade automaticamente dopo 7 giorni.

## Note

- **Scadenza automatica a 7 giorni**: I job ricorrenti vengono eliminati automaticamente dopo al massimo 7 giorni. Per pianificazioni più lunghe, ricreare il task prima della scadenza.
- **Esecuzione solo in stato inattivo**: `CronCreate` mette il prompt in coda solo quando il REPL non sta elaborando un'altra richiesta. Se il REPL è occupato al momento dell'attivazione, il prompt attende che la query corrente sia completata.
- **Evitare i minuti :00 e :30**: Per richieste di orario approssimativo, scegliere deliberatamente valori di minuto sfalsati per distribuire il carico di sistema. Riservare :00/:30 solo quando l'utente specifica quel minuto preciso.
- **Nessuna conversione del fuso orario**: L'espressione cron viene interpretata direttamente nel fuso orario locale dell'utente. Non è necessario convertire in UTC o in qualsiasi altra zona.
