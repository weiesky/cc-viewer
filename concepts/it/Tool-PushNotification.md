# PushNotification

Invia una notifica desktop dalla sessione corrente di Claude Code. Se Remote Control è connesso, invia la notifica anche al telefono dell'utente, richiamando la sua attenzione da qualunque attività stia svolgendo verso la sessione.

## Quando usare

- Un'attività di lunga durata è terminata mentre l'utente era probabilmente lontano dal terminale
- Una compilazione, un'esecuzione di test o un deployment è completato e il risultato è pronto per la revisione
- È stato raggiunto un punto decisionale che richiede l'intervento dell'utente prima di poter continuare
- È emerso un errore o un blocco che non è possibile risolvere in modo autonomo
- L'utente ha esplicitamente chiesto di essere notificato al completamento di un'attività o al verificarsi di una condizione specifica

## Quando non usare

Non inviare notifiche per aggiornamenti di avanzamento di routine durante un'attività, né per confermare di aver risposto a qualcosa che l'utente ha appena chiesto e sta chiaramente attendendo. Non notificare al termine di un'attività breve — se l'utente l'ha appena inviata e sta aspettando, la notifica non aggiunge valore e riduce la fiducia nelle notifiche future. Propendi fortemente per non inviare.

## Attivazione

- Disattivato per default (feature flag lato server).
- La consegna passa attraverso infrastruttura ospitata da Anthropic — non disponibile su Amazon Bedrock, Claude Platform on AWS, Google Cloud o Microsoft Foundry.
- Il push sul telefono richiede inoltre un client Remote Control connesso.

## Parametri

- `message` (stringa, obbligatorio): il corpo della notifica. Mantenerlo sotto i 200 caratteri; i sistemi operativi mobili troncano le stringhe più lunghe. Inizia con ciò su cui l'utente agirebbe: "build failed: 2 auth tests" è più utile di "task complete".
- `status` (stringa, obbligatorio): impostare sempre su `"proactive"`. È un indicatore fisso e non cambia.

## Esempi

### Esempio 1: notifica al completamento di un'analisi lunga

È stato richiesto un audit delle dipendenze su tutto il repository, che ha richiesto diversi minuti. L'utente si è allontanato. Quando il report è pronto:

```
message: "Audit dipendenze completato: 3 CVE critici in lodash, axios, jsonwebtoken. Report: audit-report.txt"
status: "proactive"
```

### Esempio 2: segnalare un punto decisionale durante un lavoro autonomo

Durante un refactoring in più fasi, si scopre che due moduli hanno interfacce in conflitto e non possono essere uniti senza una decisione progettuale:

```
message: "Refactoring sospeso: AuthService e UserService hanno interfacce token in conflitto. Serve una decisione per continuare."
status: "proactive"
```

## Note

- Propendi per **non** inviare. La notifica interrompe l'utente indipendentemente da ciò che sta facendo. Trattala come un costo che deve essere giustificato dal valore dell'informazione.
- Inizia con contenuto su cui si possa agire. Le prime parole devono comunicare cosa è successo e cosa, se necessario, l'utente deve fare — non un'etichetta di stato generica.
- Mantieni `message` sotto i 200 caratteri. I sistemi operativi mobili troncheranno le stringhe più lunghe, eliminando la parte più importante se appare alla fine.
- Se il risultato indica che il push non è stato inviato perché Remote Control non è connesso, è il comportamento atteso. Non sono necessari nuovi tentativi o azioni aggiuntive; la notifica desktop locale viene comunque attivata.
- Evita lo spam di notifiche. Se invii notifiche frequentemente per eventi minori, l'utente inizierà a ignorarle. Riserva questo strumento ai momenti in cui c'è una reale possibilità che l'utente si sia allontanato e voglia conoscere il risultato ora.
