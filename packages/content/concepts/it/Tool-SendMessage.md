# SendMessage

Consegna un messaggio da un membro del team a un altro all'interno di un team attivo, o trasmette a ogni teammate contemporaneamente. È l'unico canale che i teammate possono ascoltare — qualsiasi cosa scritta nell'output di testo normale è invisibile a loro.

## Quando usare

- Assegnare un compito o passare un sottoproblema a un teammate nominato durante la collaborazione di team.
- Richiedere stato, risultati intermedi o una code review da un altro agente.
- Trasmettere una decisione, un vincolo condiviso o un annuncio di spegnimento all'intero team via `*`.
- Rispondere a un prompt di protocollo come una richiesta di shutdown o una richiesta di approvazione del piano dal team leader.
- Chiudere il cerchio alla fine di un compito delegato così che il leader possa marcare l'elemento come completato.

## Attivazione

- Gated dalle stesse condizioni di messaggistica tra sessioni di `ListAgents` (feature flag lato server, disattivati per default).
- I teammate richiedono inoltre l'abilitazione dei team di agenti sperimentali.

## Parametri

- `to` (string, obbligatorio): Il `name` del teammate target come registrato nel team, oppure `*` per trasmettere a tutti i teammate contemporaneamente.
- `message` (string o object, obbligatorio): Testo semplice per comunicazioni normali, o un oggetto strutturato per risposte di protocollo come `shutdown_response` e `plan_approval_response`.
- `summary` (string, opzionale): Un'anteprima di 5–10 parole mostrata nel log di attività del team per i messaggi in testo semplice. Obbligatorio per messaggi di stringa lunghi; ignorato quando `message` è un oggetto di protocollo.

## Esempi

### Esempio 1: Passaggio diretto di un compito

```
SendMessage(
  to="db-lead",
  message="Please audit prisma/schema.prisma and list any model missing createdAt/updatedAt timestamps. Reply when done.",
  summary="Audit schema for missing timestamps"
)
```

### Esempio 2: Trasmettere un vincolo condiviso

```
SendMessage(
  to="*",
  message="Reminder: do not touch files under legacy/ — that subtree is frozen until the migration PR lands.",
  summary="Freeze legacy/ during migration"
)
```

### Esempio 3: Risposta di protocollo

Rispondi a una richiesta di shutdown dal leader usando un messaggio strutturato:

```
SendMessage(
  to="leader",
  message={ "type": "shutdown_response", "ready": true, "final_report": "All assigned diff chunks committed on branch refactor-crew/db-lead." }
)
```

### Esempio 4: Risposta di approvazione del piano

```
SendMessage(
  to="leader",
  message={ "type": "plan_approval_response", "approved": true, "notes": "LGTM, but please split step 4 into migration + backfill." }
)
```

## Note

- Il tuo normale output di testo dell'assistente NON viene trasmesso ai teammate. Se vuoi che un altro agente veda qualcosa, deve passare attraverso `SendMessage`. È l'errore più comune nei workflow di team.
- La trasmissione (`to: "*"`) è costosa — sveglia ogni teammate e consuma il loro contesto. Riservala ad annunci che genuinamente riguardano tutti. Preferisci invii mirati.
- Mantieni i messaggi concisi e orientati all'azione. Includi i percorsi dei file, i vincoli e il formato di risposta atteso di cui il destinatario ha bisogno; ricorda che non hanno memoria condivisa con te.
- Gli oggetti messaggio di protocollo (`shutdown_response`, `plan_approval_response`) hanno forme fisse. Non mescolare campi di protocollo in messaggi di testo semplice o viceversa.
- I messaggi sono asincroni. Il destinatario riceverà il tuo al suo prossimo turno; non assumere che l'abbiano letto o abbiano agito su di esso finché non rispondono.
- Un `summary` ben scritto rende il log di attività del team scorrevole per il leader — trattalo come una riga oggetto di commit.
