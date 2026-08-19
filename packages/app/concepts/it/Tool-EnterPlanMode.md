# EnterPlanMode

Commuta la sessione in plan mode, una fase di esplorazione in sola lettura in cui l'assistente indaga il codebase e redige un piano di implementazione concreto da far approvare all'utente prima di modificare qualsiasi file.

## Quando usare

- L'utente richiede un cambiamento non banale che copre più file o sottosistemi.
- I requisiti sono ambigui e l'assistente ha bisogno di leggere il codice prima di impegnarsi su un approccio.
- Viene proposto un refactor, una migrazione o un upgrade di dipendenze e il raggio d'impatto non è chiaro.
- L'utente dice esplicitamente "plan this", "facciamo prima un piano" o richiede una design review.
- Il rischio è abbastanza elevato che procedere direttamente con le modifiche potrebbe sprecare lavoro o danneggiare lo stato.

## Parametri

Nessuno. `EnterPlanMode` non accetta argomenti — invocalo con un oggetto parametri vuoto.

## Esempi

### Esempio 1: Richiesta di feature importante

L'utente chiede: "Add SSO via Okta to the admin panel." L'assistente chiama `EnterPlanMode`, quindi dedica diversi turni alla lettura del middleware di autenticazione, archivio sessioni, route guard e UI di login esistente. Scrive un piano che descrive le modifiche richieste, i passi di migrazione e la copertura dei test, quindi lo sottomette via `ExitPlanMode` per l'approvazione.

### Esempio 2: Refactor rischioso

L'utente dice: "Convert the REST controllers to tRPC." L'assistente entra in plan mode, esamina ogni controller, cataloga il contratto pubblico, elenca le fasi di rollout (shim, dual-read, cutover) e propone un piano di sequenziamento prima di toccare qualsiasi file.

## Note

- La plan mode è in sola lettura per contratto. Durante la permanenza, l'assistente non deve eseguire `Edit`, `Write`, `NotebookEdit` o qualsiasi comando shell mutante. Usa solo `Read`, `Grep`, `Glob` e comandi `Bash` non distruttivi.
- Non entrare in plan mode per modifiche banali da una riga, domande di pura ricerca o compiti in cui l'utente ha già specificato la modifica in dettaglio completo. L'overhead fa più male che bene.
- In Auto mode, la plan mode è sconsigliata a meno che l'utente non la richieda esplicitamente — Auto mode preferisce l'azione alla pianificazione preventiva.
- Usa la plan mode per ridurre le correzioni di rotta su lavoro costoso. Un piano di cinque minuti spesso salva un'ora di modifiche fuori strada.
- Una volta in plan mode, concentra l'indagine sulle parti del sistema che cambieranno realmente. Evita tour esaustivi del repository non correlati al compito corrente.
- Il piano stesso dovrebbe essere scritto su disco nel percorso che l'harness si aspetta così che `ExitPlanMode` possa sottometterlo. Il piano deve contenere percorsi di file concreti, nomi di funzioni e passi di verifica, non intenti vaghi.
- L'utente può rifiutare il piano e chiedere revisioni. Itera all'interno della plan mode finché il piano non è accettato; solo allora esci.
