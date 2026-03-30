# Descrizione dei campi del Request Body

Descrizione dei campi di primo livello del corpo della richiesta dell'API Claude `/v1/messages`.

## Elenco dei campi

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| **model** | string | Nome del modello utilizzato, ad es. `claude-opus-4-6`, `claude-sonnet-4-6` |
| **messages** | array | Cronologia dei messaggi della conversazione. Ogni messaggio contiene `role` (user/assistant) e `content` (un array di blocchi: testo, immagini, tool_use, tool_result ecc.) |
| **system** | array | System prompt. Contiene le istruzioni principali di Claude Code, le istruzioni per l'uso degli strumenti, le informazioni sull'ambiente, i contenuti di CLAUDE.md ecc. I blocchi con `cache_control` vengono memorizzati nella cache tramite prompt caching |
| **tools** | array | Elenco delle definizioni degli strumenti disponibili. Ogni strumento contiene `name`, `description` e `input_schema` (JSON Schema). Il MainAgent ha tipicamente 20+ strumenti, i SubAgent ne hanno solo pochi |
| **metadata** | object | Metadati della richiesta, tipicamente contiene `user_id` per identificare l'utente |
| **max_tokens** | number | Numero massimo di token per singola risposta del modello, ad es. `16000`, `64000` |
| **thinking** | object | Configurazione del pensiero esteso. `type: "enabled"` attiva la modalità di pensiero, `budget_tokens` controlla il limite di token per il pensiero |
| **context_management** | object | Configurazione della gestione del contesto. `truncation: "auto"` consente a Claude Code di troncare automaticamente cronologie di messaggi troppo lunghe |
| **output_config** | object | Configurazione dell'output, ad es. impostazioni di `format` |
| **stream** | boolean | Se le risposte in streaming sono abilitate. Claude Code utilizza sempre `true` |

## Struttura di messages

Il `content` di ogni messaggio è un array di blocchi con i seguenti tipi comuni:

- **text**: Contenuto testuale normale
- **tool_use**: Il modello invoca uno strumento (contiene `name`, `input`)
- **tool_result**: Risultato dell'esecuzione dello strumento (contiene `tool_use_id`, `content`)
- **image**: Contenuto immagine (base64 o URL)
- **thinking**: Processo di pensiero del modello (modalità di pensiero esteso)

## Struttura di system

L'array del system prompt contiene tipicamente:

1. **Istruzioni principali dell'agent** ("You are Claude Code...")
2. **Specifiche per l'uso degli strumenti**
3. **Contenuti di CLAUDE.md** (istruzioni a livello di progetto)
4. **Promemoria delle skill** (skills reminder)
5. **Informazioni sull'ambiente** (OS, shell, stato di git ecc.) — Di fatto, Claude Code dipende fortemente da git. Se nel progetto esiste un repository git, Claude Code riesce a dimostrare una migliore comprensione del progetto, inclusa la possibilità di recuperare modifiche remote e cronologie di commit per supportare l'analisi

I blocchi contrassegnati con `cache_control: { type: "ephemeral" }` vengono memorizzati nella cache dall'API Anthropic per 5 minuti. Quando la cache viene utilizzata, la fatturazione avviene tramite `cache_read_input_tokens` (molto inferiore rispetto a `input_tokens`).

> **Nota**: Per client speciali come Claude Code, il server Anthropic in realtà non si basa completamente sull'attributo `cache_control` nella richiesta per determinare il comportamento della cache. Il server esegue automaticamente strategie di caching per campi specifici (come il system prompt e le definizioni degli strumenti), anche quando la richiesta non contiene esplicitamente il marcatore `cache_control`. Pertanto, quando non vedete questo attributo nel corpo della richiesta, non c'è motivo di preoccuparsi: il server ha già eseguito le operazioni di caching dietro le quinte, senza esporre queste informazioni al client. Questa è una sorta di intesa tacita tra Claude Code e l'API Anthropic.
