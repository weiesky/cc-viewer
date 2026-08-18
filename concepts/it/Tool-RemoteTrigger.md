# RemoteTrigger

Chiama l'API dei trigger remoti di claude.ai per gestire l'esecuzione di attività pianificate e su richiesta. Il token OAuth viene gestito internamente dallo strumento e non viene mai esposto al modello o alla shell.

## Quando usare

- Gestire agenti remoti (trigger) su claude.ai, inclusa la visualizzazione, l'ispezione e l'aggiornamento dei trigger esistenti
- Creare una nuova attività automatizzata basata su cron che esegua un agente Claude secondo una pianificazione ricorrente
- Eseguire un trigger esistente su richiesta senza attendere la successiva esecuzione pianificata
- Elencare o verificare tutti i trigger correnti per esaminarne la configurazione e lo stato
- Aggiornare le impostazioni di un trigger, come la pianificazione, il payload o la descrizione, senza doverlo ricreare

## Attivazione

- Richiede un piano claude.ai Pro, Max, Team o Enterprise.
- Non disponibile su Amazon Bedrock, Claude Platform on AWS, Google Cloud o Microsoft Foundry.
- Richiede feature flag lato server e le impostazioni di policy `allow_remote_sessions` / `allow_routines`.
- Non per le sessioni remote stesse.

## Parametri

- `action` (string, obbligatorio): l'operazione da eseguire — uno tra `list`, `get`, `create`, `update` o `run`
- `trigger_id` (string, obbligatorio per `get`, `update` e `run`): l'identificatore del trigger su cui operare; deve corrispondere al pattern `^[\w-]+$` (solo caratteri di parola e trattini)
- `body` (object, obbligatorio per `create` e `update`; facoltativo per `run`): il payload della richiesta inviata all'API

## Esempi

### Esempio 1: elencare tutti i trigger

```json
{
  "action": "list"
}
```

Chiama `GET /v1/code/triggers` e restituisce un array JSON di tutti i trigger associati all'account autenticato.

### Esempio 2: creare un nuovo trigger che viene eseguito ogni mattina nei giorni feriali

```json
{
  "action": "create",
  "body": {
    "name": "weekday-morning-report",
    "schedule": "0 8 * * 1-5",
    "description": "Generare un riepilogo giornaliero ogni giorno feriale alle 08:00 UTC"
  }
}
```

Chiama `POST /v1/code/triggers` con il corpo fornito e restituisce l'oggetto trigger appena creato, incluso il `trigger_id` assegnato.

### Esempio 3: eseguire un trigger su richiesta

```json
{
  "action": "run",
  "trigger_id": "my-report-trigger"
}
```

Chiama immediatamente `POST /v1/code/triggers/my-report-trigger/run`, ignorando l'orario pianificato.

### Esempio 4: recuperare un singolo trigger

```json
{
  "action": "get",
  "trigger_id": "my-report-trigger"
}
```

Chiama `GET /v1/code/triggers/my-report-trigger` e restituisce la configurazione completa del trigger.

## Note

- Il token OAuth viene iniettato nel processo dallo strumento — non copiare, incollare o registrare mai i token manualmente; farlo crea un rischio per la sicurezza ed è superfluo quando si utilizza questo strumento.
- Preferire questo strumento a `curl` grezzo o ad altri client HTTP per tutte le chiamate all'API dei trigger; l'utilizzo diretto di HTTP aggira l'iniezione sicura del token e può esporre le credenziali.
- Lo strumento restituisce la risposta JSON grezza dell'API; il chiamante è responsabile dell'analisi della risposta e della gestione dei codici di stato di errore.
- Il valore di `trigger_id` deve corrispondere al pattern `^[\w-]+$` — sono ammessi solo caratteri alfanumerici, trattini bassi e trattini; spazi o caratteri speciali causeranno il fallimento della richiesta.
