# Descrizione dei campi del Response Body

Descrizione dei campi del corpo della risposta dell'API Claude `/v1/messages`.

## Campi di primo livello

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| **model** | string | Nome del modello effettivamente utilizzato, ad es. `claude-opus-4-6` |
| **id** | string | Identificatore univoco di questa risposta, ad es. `msg_01Tgsr2QeH8AVXGoP2wAXRvU` |
| **type** | string | Sempre `"message"` |
| **role** | string | Sempre `"assistant"` |
| **content** | array | Array dei blocchi di contenuto prodotti dal modello, inclusi testo, chiamate a tool, processo di pensiero, ecc. |
| **stop_reason** | string | Motivo dell'arresto: `"end_turn"` (completamento normale), `"tool_use"` (necessaria esecuzione di un tool), `"max_tokens"` (raggiunto il limite di token) |
| **stop_sequence** | string/null | La sequenza che ha attivato l'arresto, di solito `null` |
| **usage** | object | Statistiche di utilizzo dei token (vedi sotto) |

## Tipi di blocco content

| Tipo | Descrizione |
|------|-------------|
| **text** | Risposta testuale del modello, contiene il campo `text` |
| **tool_use** | Richiesta di chiamata a un tool, contiene `name` (nome del tool), `input` (parametri), `id` (ID della chiamata, usato per associare il tool_result) |
| **thinking** | Contenuto del pensiero esteso (appare solo con la modalità thinking attivata), contiene il campo `thinking` |

## Dettaglio dei campi usage

| Campo | Descrizione |
|-------|-------------|
| **input_tokens** | Numero di token di input non presenti nella cache (addebitati a prezzo pieno) |
| **cache_creation_input_tokens** | Numero di token per cui è stata creata una nuova cache in questa richiesta (scrittura cache, costo superiore all'input normale) |
| **cache_read_input_tokens** | Numero di token letti dalla cache (lettura cache, costo molto inferiore all'input normale) |
| **output_tokens** | Numero di token prodotti dal modello |
| **service_tier** | Livello di servizio, ad es. `"standard"` |
| **inference_geo** | Regione di inferenza, ad es. `"not_available"` indica che l'informazione sulla regione non è disponibile |

## Sottocampi di cache_creation

| Campo | Descrizione |
|-------|-------------|
| **ephemeral_5m_input_tokens** | Numero di token per la creazione di cache a breve termine con TTL di 5 minuti |
| **ephemeral_1h_input_tokens** | Numero di token per la creazione di cache a lungo termine con TTL di 1 ora |

> **Sulla tariffazione della cache**: Il prezzo unitario di `cache_read_input_tokens` è molto inferiore a quello di `input_tokens`, mentre il prezzo unitario di `cache_creation_input_tokens` è leggermente superiore a quello dell'input normale. Pertanto, mantenere un alto tasso di hit della cache nelle conversazioni continuative può ridurre significativamente i costi. Tramite la metrica "tasso di hit" di cc-viewer è possibile monitorare visivamente questa proporzione.

## Significato di stop_reason

- **end_turn**: Il modello ha completato normalmente la risposta
- **tool_use**: Il modello deve chiamare un tool; content conterrà un blocco `tool_use`. Nella richiesta successiva è necessario aggiungere un `tool_result` nei messages per continuare la conversazione
- **max_tokens**: Raggiunto il limite `max_tokens`, la risposta è stata troncata e potrebbe essere incompleta
