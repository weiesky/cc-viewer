# Perché i Tools sono elencati per primi?

Nel pannello Context di cc-viewer, **i Tools appaiono prima di System Prompt e Messages**. Questo ordine riflette con precisione la **sequenza del prefisso KV-Cache dell'API di Anthropic**.

## Sequenza del prefisso KV-Cache

Quando l'API di Anthropic costruisce il KV-Cache, concatena il contesto in un prefisso in questo **ordine fisso**:

```
┌─────────────────────────────────────────────────┐
│ 1. Tools (JSON Schema definitions)               │  ← Start of cache prefix
│ 2. System Prompt                                 │
│ 3. Messages (conversation history + current turn)│  ← End of cache prefix
└─────────────────────────────────────────────────┘
```

Ciò significa che **i Tools si trovano prima del System Prompt, all'inizio del prefisso di cache**.

## Perché i Tools hanno un peso di cache maggiore di System?

Nella corrispondenza del prefisso KV-Cache, **il contenuto precedente è più critico** — qualsiasi modifica invalida tutto ciò che segue:

1. **La corrispondenza del prefisso inizia dall'inizio**: Il KV-Cache confronta la richiesta corrente con il prefisso memorizzato nella cache token per token dall'inizio. Nel momento in cui viene rilevata una discrepanza, tutto il contenuto successivo viene invalidato.

2. **Modifica dei Tools = intera cache invalidata**: Poiché i Tools sono in prima posizione, qualsiasi modifica alle definizioni dei tool (anche aggiungere o rimuovere un singolo MCP tool) **rompe il prefisso dal primissimo inizio**, invalidando tutti i System Prompt e i Messages memorizzati nella cache.

3. **Modifica di System = cache dei Messages invalidata**: Il System Prompt si trova nel mezzo, quindi le sue modifiche invalidano solo la porzione dei Messages che segue.

4. **Modifica dei Messages = solo la coda è interessata**: I Messages sono alla fine, quindi aggiungere nuovi messages invalida solo un piccolo segmento finale — le cache di Tools e System rimangono intatte.

## Impatto pratico

| Tipo di modifica | Impatto sulla cache | Scenario tipico |
|-------------|-------------|-----------------|
| Tool aggiunto/rimosso | **Invalidazione completa** | Connessione/disconnessione server MCP, attivazione/disattivazione plugin IDE |
| Modifica del System Prompt | Cache dei Messages persa | Modifica di CLAUDE.md, iniezione di system reminder |
| Nuovo message aggiunto | Solo incremento della coda | Flusso di conversazione normale (il più comune, il meno costoso) |

Ecco perché `tools_change` in [CacheRebuild](CacheRebuild.md) tende ad essere il motivo di ricostruzione più costoso — rompe la catena del prefisso fin dall'inizio.

## Perché le definizioni degli strumenti vengono prima del "cervello"?

Dal punto di vista della cache, il fatto che i Tools siano per primi è un dato tecnico. Ma dal punto di vista del design cognitivo, quest'ordine è altrettanto logico — **i Tools sono le mani e i piedi, il System Prompt è il cervello**.

Prima di agire, una persona deve percepire quali arti e strumenti ha a disposizione. Un neonato non comprende prima le regole del mondo (System) per poi imparare ad afferrare — percepisce prima di avere mani e piedi, poi comprende gradualmente le regole attraverso l'interazione con l'ambiente. Allo stesso modo, un LLM deve sapere quali strumenti può chiamare (leggere file, scrivere codice, cercare, eseguire comandi) prima di ricevere le istruzioni del compito (System Prompt), per poter valutare con precisione "cosa posso fare" e "come devo procedere" nell'elaborare le istruzioni.

Se fosse il contrario — dire prima al modello "il tuo compito è ristrutturare questo modulo", poi "hai gli strumenti Read, Edit, Bash" — il modello mancherebbe di informazioni cruciali sui limiti delle proprie capacità nella comprensione del compito, producendo potenzialmente piani irrealistici o trascurando approcci disponibili.

**Conoscere le carte che si hanno prima di decidere come giocarle.** Questa è la logica cognitiva dietro il posizionamento dei Tools prima del System.

## Perché anche gli strumenti MCP sono in questa posizione?

Gli strumenti MCP (Model Context Protocol), come gli strumenti integrati, sono posizionati all'inizio dell'area Tools. Comprendere la posizione di MCP nel contesto aiuta a valutare i reali benefici e costi.

### Vantaggi di MCP

- **Estensione delle capacità**: MCP permette ai modelli di accedere a servizi esterni (query database, chiamate API, operazioni IDE, controllo browser, ecc.), superando i limiti degli strumenti integrati
- **Ecosistema aperto**: Chiunque può implementare un server MCP; il modello acquisisce nuove capacità senza ri-addestramento
- **Caricamento su richiesta**: I server MCP possono essere connessi/disconnessi selettivamente in base allo scenario, componendo insiemi di strumenti flessibili

### Costi di MCP

- **Cache killer**: La definizione JSON Schema di ogni strumento MCP viene concatenata all'inizio del prefisso KV-Cache. Aggiungere o rimuovere uno strumento MCP = **tutta la cache invalidata dall'inizio**. Connettere/disconnettere frequentemente server MCP riduce drasticamente il tasso di successo della cache
- **Gonfiamento del prefisso**: Gli Schema degli strumenti MCP sono tipicamente più grandi degli strumenti integrati (descrizioni dettagliate dei parametri, valori enum, ecc.). Molti strumenti MCP aumentano significativamente il conteggio dei token nell'area Tools, riducendo lo spazio di contesto disponibile per i Messages
- **Overhead di latenza**: Le chiamate agli strumenti MCP richiedono comunicazione tra processi (JSON-RPC su stdio/SSE), un ordine di grandezza più lento delle chiamate a funzioni integrate
- **Rischio di stabilità**: I server MCP sono processi esterni che possono bloccarsi, andare in timeout o restituire formati inattesi, richiedendo gestione degli errori aggiuntiva

### Raccomandazioni pratiche

| Scenario | Raccomandazione |
|----------|----------------|
| Conversazioni lunghe, interazione frequente | Minimizzare il numero di strumenti MCP per proteggere la stabilità del prefisso di cache |
| Compiti brevi, operazioni una tantum | Usare liberamente gli strumenti MCP; l'impatto sulla cache è limitato |
| Aggiunta/rimozione frequente di server MCP | Ogni modifica attiva una ricostruzione completa della cache; considerare di fissare l'insieme di strumenti |
| Schema di strumenti sovradimensionati | Ridurre descrizioni ed enum per diminuire il consumo di token nel prefisso |

Nel pannello Context di cc-viewer, gli strumenti MCP sono visualizzati accanto agli strumenti integrati nell'area Tools, offrendo una vista chiara delle dimensioni dello Schema di ogni strumento e del suo contributo al prefisso di cache.
