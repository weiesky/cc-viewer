# ExitPlanMode

Sottomette il piano di implementazione redatto durante la plan mode per l'approvazione dell'utente e — se approvato — fa transitare la sessione fuori dalla plan mode così che le modifiche possano iniziare.

## Quando usare

- Un piano scritto durante `EnterPlanMode` è completo e pronto per la revisione.
- Il compito è focalizzato sull'implementazione (modifiche a codice o configurazione), non pura ricerca, quindi un piano esplicito è appropriato.
- Tutte le letture e analisi prerequisite sono state effettuate; non serve ulteriore indagine prima che l'utente decida.
- L'assistente ha enumerato percorsi di file, funzioni e passi concreti — non solo obiettivi.
- L'utente ha chiesto di vedere il piano, o il workflow di plan mode sta per passare il controllo agli strumenti di editing.

## Parametri

- `allowedPrompts` (array, opzionale): Prompt che l'utente può digitare nella schermata di approvazione per auto-approvare o alterare il piano. Ogni elemento specifica un permesso con scope (ad esempio, un nome di operazione e il tool a cui si applica). Lascia non impostato per usare il flusso di approvazione predefinito.

## Esempi

### Esempio 1: Sottomissione standard

Dopo aver indagato un refactor di autenticazione all'interno della plan mode e aver scritto il file del piano su disco, l'assistente chiama `ExitPlanMode` senza argomenti. L'harness legge il piano dalla sua posizione canonica, lo mostra all'utente e attende approvazione o rifiuto.

### Esempio 2: Azioni rapide pre-approvate

```
ExitPlanMode(allowedPrompts=[
  {"tool": "Bash", "prompt": "run tests"},
  {"tool": "Bash", "prompt": "install dependencies"}
])
```

Permette all'utente di concedere in anticipo il permesso per comandi di follow-up di routine, così che l'assistente non debba fermarsi per ogni prompt di permesso durante l'implementazione.

## Note

- `ExitPlanMode` ha senso solo per lavoro di tipo implementativo. Se la richiesta dell'utente è un compito di ricerca o spiegazione senza cambiamenti ai file, rispondi direttamente — non passare attraverso la plan mode solo per uscirne.
- Il piano deve già essere scritto su disco prima di chiamare questo tool. `ExitPlanMode` non accetta il corpo del piano come parametro; legge dal percorso che l'harness si aspetta.
- Se l'utente rifiuta il piano, ritorni in plan mode. Revisiona in base al feedback e sottometti di nuovo; non iniziare a modificare file mentre il piano non è approvato.
- L'approvazione concede il permesso di lasciare la plan mode e usare strumenti mutanti (`Edit`, `Write`, `Bash` e così via) per lo scope descritto nel piano. Espandere lo scope successivamente richiede un nuovo piano o consenso esplicito dell'utente.
- Non usare `AskUserQuestion` per chiedere "questo piano va bene?" prima di chiamare questo tool — richiedere l'approvazione del piano è esattamente ciò che fa `ExitPlanMode`, e l'utente non può vedere il piano fino a quando non viene sottomesso.
- Mantieni il piano minimale e azionabile. Un revisore dovrebbe poterlo scorrere in meno di un minuto e capire esattamente cosa cambierà.
- Se ti rendi conto durante l'implementazione che il piano era sbagliato, fermati e riferisci all'utente invece di deviare silenziosamente. Rientrare in plan mode è un passo successivo valido.
