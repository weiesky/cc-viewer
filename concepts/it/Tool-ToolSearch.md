# ToolSearch

Recupera su richiesta le definizioni di schema complete degli «strumenti differiti» affinché diventino richiamabili. Quando sono disponibili molti strumenti, alcuni non vengono caricati fin dall'inizio — compaiono solo per nome all'interno dei messaggi `<system-reminder>`. Finché il suo schema non viene recuperato, è noto solo il nome e non esiste alcuna definizione di parametri, quindi lo strumento non può essere invocato. `ToolSearch` prende una query, la confronta con l'elenco degli strumenti differiti e restituisce le definizioni JSONSchema complete degli strumenti corrispondenti all'interno di un blocco `<functions>`. Una volta che lo schema di uno strumento compare nel risultato, è richiamabile esattamente come qualsiasi strumento definito in cima al prompt.

## Quando usare

- Hai bisogno di uno strumento differito — il suo nome compare in un `<system-reminder>`, ma non c'è alcuna definizione di parametri per esso nell'elenco degli strumenti di primo livello.
- Vuoi usare gli strumenti di un server MCP (es. Slack, Gmail, computer-use) che vengono caricati su richiesta.
- Non sei sicuro del nome esatto dello strumento per una capacità e vuoi far emergere candidati per parola chiave in un colpo solo.

Se lo schema di uno strumento è già nel contesto, non cercare di nuovo — limitati a richiamarlo.

## Attivazione

- Attivo per default.
- Disattivato quando `ANTHROPIC_BASE_URL` punta a un endpoint non-Anthropic (a meno che `ENABLE_TOOL_SEARCH` sia impostato), quando `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` è impostato, quando il modello non supporta i riferimenti ai tool (modelli Vertex AI precedenti a Claude 4.5), o quando negato tramite `"deny": ["ToolSearch"]`.

## Parametri

- `query` (string, obbligatorio): La query usata per localizzare gli strumenti differiti. Sono supportate tre forme:
  - `select:Read,Edit,Grep` — recuperare questi strumenti esatti per nome.
  - `notebook jupyter` — ricerca per parola chiave, che restituisce fino a `max_results` migliori corrispondenze.
  - `+slack send` — richiede che `slack` compaia nel nome dello strumento, poi ordina in base ai termini rimanenti.
- `max_results` (number, opzionale): Numero massimo di risultati da restituire. Default: 5.

## Esempi

### Esempio 1: Recupero per nome esatto

```
ToolSearch(query="select:WebFetch,WebSearch", max_results=5)
```

### Esempio 2: Ricerca per parola chiave

```
ToolSearch(query="notebook jupyter", max_results=5)
```

### Esempio 3: Caricare un intero toolkit MCP in una volta

Quando si caricano in blocco tutti gli strumenti di un server MCP (es. computer-use), usa una singola ricerca per parola chiave invece di selezionarli uno per uno — il nome del server come sottostringa corrisponde a ogni strumento sotto quel server:

```
ToolSearch(query="computer-use", max_results=30)
```

## Note

- Prima di invocare uno strumento differito devi recuperarne lo schema con `ToolSearch` — richiamarlo direttamente fallisce perché manca la definizione dei parametri.
- Quando si carica in blocco un intero toolkit (es. tutti gli strumenti di un server MCP), preferisci una singola ricerca per parola chiave a molte chiamate `select:` per ridurre i viaggi di andata e ritorno.
- Una volta recuperato lo schema, lo strumento si comporta esattamente come qualsiasi strumento normale; non cercare di nuovo lo stesso strumento.
- I risultati tornano come blocco `<functions>`, ogni strumento su una singola riga `<function>{...}</function>` — la stessa codifica dell'elenco di strumenti di primo livello.
