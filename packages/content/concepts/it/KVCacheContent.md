# Contenuto della KV-Cache

## Cos'e il Prompt Caching?

Quando comunichi con Claude, ogni richiesta API invia l'intero contesto della conversazione (system prompt + definizioni degli strumenti + cronologia dei messaggi). Il meccanismo di prompt caching di Anthropic memorizza sul server i contenuti del prefisso gia calcolati. Se le richieste successive hanno lo stesso prefisso, i risultati memorizzati vengono riutilizzati direttamente, saltando i calcoli ridondanti e riducendo significativamente latenza e costi.

In cc-viewer questo meccanismo viene chiamato "KV-Cache" e corrisponde al prompt caching a livello di API Anthropic, non alla key-value cache interna dei livelli di attenzione del transformer dell'LLM.

## Come funziona il caching

Il prompt caching di Anthropic costruisce la chiave di cache in un ordine fisso:

```
Tools → System Prompt → Messages (fino al cache breakpoint)
```

Finche questo prefisso corrisponde esattamente a una richiesta precedente all'interno della finestra TTL, l'API restituira un cache hit (`cache_read_input_tokens`) invece di ricalcolare (`cache_creation_input_tokens`).

> **Claude Code non dipende strettamente dall'attributo `cache_control`. Il server rimuove parzialmente questi attributi, ma riesce comunque a creare la cache efficacemente. Quindi l'assenza dell'attributo `cache_control` non significa che il contenuto non sia stato memorizzato nella cache.**
>
> Per client speciali come Claude Code, il server di Anthropic non si basa completamente sull'attributo `cache_control` nella richiesta per determinare il comportamento della cache. Il server esegue automaticamente strategie di caching per campi specifici (come system prompt e definizioni degli strumenti), anche quando la richiesta non contiene marcatori `cache_control` espliciti. Pertanto, se non vedi questo attributo nel corpo della richiesta, non c'e motivo di preoccupazione: il server ha gia completato l'operazione di caching dietro le quinte, semplicemente non espone questa informazione al client. Questa e un'intesa tacita tra Claude Code e l'API di Anthropic.

## Cos'e il "contenuto attuale della KV-Cache"?

Il "contenuto attuale della KV-Cache" mostrato in cc-viewer viene estratto dall'ultima richiesta del MainAgent e include il contenuto che precede il confine della cache (cache breakpoint). Nello specifico comprende:

- **System Prompt**: le istruzioni di sistema di Claude Code, incluse le istruzioni principali dell'agent, le specifiche d'uso degli strumenti, le istruzioni del progetto CLAUDE.md, le informazioni sull'ambiente, ecc.
- **Tools**: l'elenco delle definizioni degli strumenti attualmente disponibili (come Read, Write, Bash, Agent, strumenti MCP, ecc.)
- **Messages**: la porzione memorizzata della cronologia della conversazione (tipicamente i messaggi piu vecchi, fino all'ultimo marcatore `cache_control`)

## Perche visualizzare il contenuto della cache?

1. **Comprendere il contesto**: scopri quali contenuti Claude ha attualmente "in memoria" per valutare se il suo comportamento corrisponde alle aspettative
2. **Ottimizzazione dei costi**: i cache hit costano molto meno dei ricalcoli. Visualizzare il contenuto della cache aiuta a capire perche certe richieste hanno attivato una ricostruzione della cache (cache rebuild)
3. **Debug delle conversazioni**: quando le risposte di Claude non corrispondono alle aspettative, controllare il contenuto della cache permette di verificare che il system prompt e la cronologia dei messaggi siano corretti
4. **Monitoraggio della qualita del contesto**: durante il debug, la modifica delle configurazioni o la regolazione dei prompt, il KV-Cache-Text offre una vista centralizzata che ti aiuta a verificare rapidamente se il contesto principale si e degradato o e stato contaminato da contenuti inattesi, senza dover scorrere manualmente ogni singolo messaggio originale

## Strategia di caching multilivello

La KV-Cache di Claude Code non e composta da un'unica cache. Il server genera cache separate per Tools e System Prompt, indipendenti dalla cache dei Messages. Il vantaggio di questo design e che quando lo stack dei messaggi presenta problemi (come troncamento del contesto, modifiche ai messaggi, ecc.) e necessita di ricostruzione, le cache di Tools e System Prompt non vengono invalidate insieme, evitando un ricalcolo completo.

Questa e una strategia di ottimizzazione attuale del server: poiche le definizioni degli strumenti e il system prompt sono relativamente stabili durante l'uso normale e cambiano raramente, memorizzarli separatamente nella cache riduce al minimo il sovracosto di ricostruzioni non necessarie. Osservando la cache noterai che, a parte la ricostruzione dei Tools (che richiede il refresh completo della cache), le modifiche al System Prompt e ai Messages hanno comunque cache ereditabili disponibili.

## Ciclo di vita della cache

- **Creazione**: alla prima richiesta o dopo l'invalidazione della cache, l'API crea una nuova cache (`cache_creation_input_tokens`)
- **Hit**: le richieste successive con prefisso identico riutilizzano la cache (`cache_read_input_tokens`)
- **Scadenza**: la cache ha un TTL (Time to Live) di 5 minuti e scade automaticamente al termine
- **Ricostruzione**: quando il system prompt, l'elenco degli strumenti, il modello o il contenuto dei messaggi cambiano, la chiave di cache non corrisponde piu e viene attivata una ricostruzione della cache al livello corrispondente
