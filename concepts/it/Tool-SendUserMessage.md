# SendUserMessage

Invia un messaggio all'utente — il canale di output visibile primario nelle sessioni in stile brief. Noto anche con il suo alias legacy `Brief`.

## Quando usare

- Rispondere a qualcosa che l'utente ha appena detto (`status="normal"`).
- Far emergere proattivamente qualcosa che l'utente non ha chiesto e deve vedere ora — un compito che si completa mentre è assente, un blocco che hai incontrato, un aggiornamento di stato non richiesto (`status="proactive"`).

## Parametri

In brief mode:

- `message` (string, obbligatorio): Il messaggio per l'utente. Supporta la formattazione markdown.
- `attachments` (array, opzionale): Allegati mostrati insieme al messaggio. Ogni voce è o un percorso di file (assoluto o relativo alla cwd) per un file leggibile localmente, o un oggetto pre-risolto `{file_uuid, file_name, size, is_image}` ottenuto da un tool di dispositivo come `attach_file`.
- `status` (string, obbligatorio): `proactive` per aggiornamenti non richiesti di cui l'utente ha bisogno ora; `normal` quando rispondi all'utente.

Nelle build non-brief è disponibile solo `message`.

## Esempi

### Esempio 1: Avviso di completamento proattivo

```
SendUserMessage(
  message="The migration finished — 42 files updated, tests green.",
  status="proactive"
)
```

## Note

- Abilitato solo in brief mode o tramite il corrispondente feature rollout; la maggior parte delle sessioni CLI interattive parla direttamente con l'utente.
- Usa `proactive` con parsimonia — è pensato per cose che richiedono genuinamente l'attenzione dell'utente ora.
