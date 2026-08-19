# Skill

Invoca una skill nominata all'interno della conversazione corrente. Le skill sono bundle di capacità pre-confezionati — conoscenza di dominio, workflow e a volte accesso a tool — che l'harness espone all'assistente tramite avvisi di sistema.

## Quando usare

- L'utente digita un comando slash come `/review` o `/init` — i comandi slash sono skill e devono essere eseguiti tramite questo tool.
- L'utente descrive un compito che corrisponde alle condizioni di attivazione di una skill pubblicizzata (ad esempio, chiedere di scansionare i transcript per prompt di permessi ripetuti corrisponde a `fewer-permission-prompts`).
- Lo scopo dichiarato di una skill corrisponde direttamente al file corrente, alla richiesta o al contesto della conversazione.
- Workflow specializzati e ripetibili sono disponibili come skill e la procedura canonica è preferibile a un approccio ad hoc.
- L'utente chiede "quali skill sono disponibili" — elenca i nomi pubblicizzati e invoca solo quando confermano.

## Parametri

- `skill` (string, obbligatorio): Il nome esatto di una skill elencata nell'avviso di sistema delle skill disponibili corrente. Per le skill con namespace di plugin, usa la forma completa `plugin:skill` (ad esempio `skill-creator:skill-creator`). Non includere uno slash iniziale.
- `args` (string, opzionale): Argomenti a forma libera passati alla skill. Formato e semantica sono definiti dalla documentazione di ciascuna skill.

## Esempi

### Esempio 1: Eseguire una skill di review sul branch corrente

```
Skill(skill="review")
```

La skill `review` impacchetta i passi per revisionare una pull request rispetto al branch di base corrente. Invocarla carica la procedura di review definita dall'harness nel turno.

### Esempio 2: Invocare una skill con namespace di plugin con argomenti

```
Skill(
  skill="skill-creator:skill-creator",
  args="create a skill that summarizes git log for a given date range"
)
```

Instrada la richiesta attraverso il punto di ingresso del plugin `skill-creator` così che il workflow di creazione si attivi.

## Note

- Invoca solo skill i cui nomi appaiono verbatim nell'avviso di sistema delle skill disponibili, o skill che l'utente ha digitato direttamente come `/name` nel suo messaggio. Non indovinare o inventare nomi di skill dalla memoria o dai dati di addestramento — se la skill non è pubblicizzata, non chiamare questo tool.
- Quando una richiesta dell'utente corrisponde a una skill pubblicizzata, chiamare `Skill` è un prerequisito bloccante: invocala prima di generare qualsiasi altra risposta sul compito. Non descrivere cosa farebbe la skill — eseguila.
- Non menzionare mai una skill per nome senza effettivamente invocarla. Annunciare una skill senza chiamare il tool è fuorviante.
- Non usare `Skill` per comandi CLI integrati come `/help`, `/clear`, `/model` o `/exit`. Quelli sono gestiti direttamente dall'harness.
- Non re-invocare una skill già in esecuzione nel turno corrente. Se vedi un tag `<command-name>` nel turno corrente, la skill è già stata caricata — segui le sue istruzioni in loco invece di chiamare nuovamente il tool.
- Se più skill potrebbero applicarsi, scegli quella più specifica. Per modifiche di configurazione come aggiungere permessi o hook, preferisci `update-config` a un approccio generico alle impostazioni.
- L'esecuzione di una skill può introdurre nuovi avvisi di sistema, tool o vincoli per il resto del turno. Rileggi lo stato della conversazione dopo che una skill è completata prima di procedere.
