# CC-Viewer
[![npm version](https://img.shields.io/npm/v/cc-viewer)](https://www.npmjs.com/package/cc-viewer)

Un sistema di monitoraggio delle richieste per Claude Code che cattura e visualizza tutte le richieste e risposte API in tempo reale. Aiuta gli sviluppatori a monitorare il proprio Context per la revisione e il debug durante il Vibe Coding.

[简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Utilizzo

```bash
npm install -g cc-viewer
```

Dopo l'installazione, eseguire:

```bash
ccv
```

Questo comando rileva automaticamente il metodo di installazione locale di Claude Code (NPM o Native Install) e si adatta.

- **Installazione NPM**: Inietta automaticamente lo script intercettore in `cli.js` di Claude Code.
- **Native Install**: Rileva automaticamente il binario `claude`, configura un proxy trasparente locale e configura un Hook Shell Zsh per instradare automaticamente il traffico.

### Override della configurazione (Configuration Override)

Se è necessario utilizzare un endpoint API personalizzato (ad es. proxy aziendale), configurarlo semplicemente in `~/.claude/settings.json` o impostare la variabile d'ambiente `ANTHROPIC_BASE_URL`. `ccv` riconoscerà automaticamente queste impostazioni e inoltrerà le richieste correttamente.

### Modalità silenziosa (Silent Mode)

Per impostazione predefinita, `ccv` viene eseguito in modalità silenziosa quando avvolge `claude`, garantendo che l'output del terminale rimanga pulito e identico all'esperienza originale di Claude Code. Tutti i log vengono acquisiti in background e sono visibili su `http://localhost:7008`.

Quindi utilizzare Claude Code come al solito e aprire `http://localhost:7008` nel browser per visualizzare l'interfaccia di monitoraggio.

### Risoluzione dei problemi (Troubleshooting)

- **Output misto (Mixed Output)**: Se vedi log di debug `[CC-Viewer]` mescolati con l'output di Claude, aggiorna all'ultima versione (`npm install -g cc-viewer`).
- **Connessione rifiutata (Connection Refused)**: Assicurati che il processo in background `ccv` sia in esecuzione. L'esecuzione di `ccv` o `claude` (dopo l'installazione dell'hook) dovrebbe avviarlo automaticamente.
- **Corpo vuoto (Empty Body)**: Se vedi "No Body" nel visualizzatore, potrebbe essere dovuto a formati SSE non standard. Il visualizzatore ora supporta l'acquisizione di contenuti grezzi come fallback.

### Controlla versione (Check Version)

```bash
ccv --version
```

### Disinstallazione

```bash
ccv --uninstall
```

## Funzionalità

### Monitoraggio delle richieste (Raw Mode)

- Cattura in tempo reale di tutte le richieste API da Claude Code, incluse le risposte in streaming
- Il pannello sinistro mostra il metodo di richiesta, URL, durata e codice di stato
- Identificazione ed etichettatura automatica delle richieste Main Agent e Sub Agent (sottotipi: Bash, Task, Plan, General)
- La lista delle richieste scorre automaticamente all'elemento selezionato (centrato al cambio di modalità, più vicino al clic manuale)
- Il pannello destro supporta il passaggio tra le schede Request / Response
- Il Request Body espande `messages`, `system`, `tools` di un livello per impostazione predefinita
- Il Response Body completamente espanso per impostazione predefinita
- Passaggio tra vista JSON e vista testo semplice
- Copia del contenuto JSON con un clic
- Le richieste MainAgent supportano Body Diff JSON, mostrando in modo compresso le differenze con la richiesta MainAgent precedente (solo campi modificati/aggiunti)
- La sezione Diff supporta il passaggio tra vista JSON e vista testo, con copia del contenuto con un clic
- Impostazione "Expand Diff": quando attivata, le richieste MainAgent espandono automaticamente la sezione diff
- Il tooltip Body Diff JSON può essere chiuso; una volta chiuso, la preferenza viene salvata lato server e non viene più mostrato
- Gli header sensibili (`x-api-key`, `authorization`) vengono automaticamente mascherati nei file di log JSONL per prevenire la divulgazione delle credenziali
- Statistiche di utilizzo Token inline per richiesta (token di input/output, creazione/lettura cache, tasso di successo)
- Compatibile con Claude Code Router (CCR) e altre configurazioni proxy — le richieste vengono rilevate tramite pattern del percorso API come fallback

### Chat Mode

Fare clic sul pulsante "Chat mode" in alto a destra per analizzare la cronologia completa delle conversazioni del Main Agent in un'interfaccia di chat:

- Messaggi dell'utente allineati a destra (bolle blu), risposte del Main Agent allineate a sinistra (bolle scure) con rendering Markdown
- Messaggi `/compact` rilevati automaticamente e mostrati compressi, fare clic per espandere il riepilogo completo
- Risultati delle chiamate agli strumenti visualizzati in linea all'interno del messaggio Assistant corrispondente
- Blocchi `thinking` compressi per impostazione predefinita, renderizzati come Markdown, fare clic per espandere; traduzione con un clic supportata
- `tool_use` mostrato come schede compatte di chiamata strumenti (Bash, Read, Edit, Write, Glob, Grep, Task hanno ciascuno visualizzazioni dedicate)
- Risultati degli strumenti Task (SubAgent) renderizzati come Markdown
- Messaggi di selezione dell'utente (AskUserQuestion) mostrati in formato domanda e risposta
- Tag di sistema (`<system-reminder>`, `<project-reminder>`, ecc.) auto-compressi
- Messaggi di caricamento Skill rilevati automaticamente e compressi, mostrando il nome dello Skill; clic per espandere la documentazione completa (rendering Markdown)
- Skills reminder rilevato automaticamente e compresso
- Testo di sistema auto-filtrato, mostrando solo l'input reale dell'utente
- Visualizzazione segmentata multi-sessione (segmentazione automatica dopo `/compact`, `/clear`, ecc.)
- Ogni messaggio mostra un timestamp preciso al secondo, derivato dal timing della richiesta API
- Ogni messaggio ha un link "Visualizza richiesta" per tornare alla modalità raw alla richiesta API corrispondente
- Sincronizzazione bidirezionale delle modalità: passando alla modalità chat si scorre alla conversazione corrispondente alla richiesta selezionata; tornando indietro si scorre alla richiesta selezionata
- Pannello impostazioni: attiva/disattiva lo stato di compressione predefinito per i risultati degli strumenti e i blocchi di pensiero
- Impostazioni globali: attiva/disattiva il filtraggio delle richieste irrilevanti (count_tokens, heartbeat)

### Traduzione

- I blocchi thinking e i messaggi Assistant supportano la traduzione con un clic
- Basato su Claude Haiku API, utilizza solo l'autenticazione `x-api-key` (i token di sessione OAuth sono esclusi per prevenire l'inquinamento del contesto)
- Cattura automaticamente il nome del modello haiku dalle richieste mainAgent; predefinito `claude-haiku-4-5-20251001`
- I risultati della traduzione vengono memorizzati automaticamente; clicca di nuovo per tornare al testo originale
- Animazione di caricamento durante la traduzione
- L'icona (?) accanto all'header `authorization` nei dettagli della richiesta rimanda al documento concettuale sull'inquinamento del contesto

### Statistiche Token

Pannello al passaggio del mouse nell'area dell'intestazione:

- Conteggio Token raggruppato per modello (input/output)
- Contatori di creazione/lettura Cache e tasso di successo della Cache
- Statistiche di ricostruzione della Cache raggruppate per motivo (TTL, cambio system/tools/model, troncamento/modifica messaggi, cambio chiave) con conteggio e token cache_creation
- Statistiche di utilizzo degli strumenti: conteggio chiamate per strumento, ordinato per frequenza
- Statistiche utilizzo Skill: frequenza di chiamata per Skill, ordinate per frequenza
- Icone di aiuto concettuale (?): clicca per visualizzare la documentazione integrata di MainAgent, CacheRebuild e ogni strumento
- Conto alla rovescia della scadenza della Cache del Main Agent

### Gestione dei Log

Tramite il menu a tendina CC-Viewer in alto a sinistra:

- Importa log locali: sfoglia i file di log storici, raggruppati per progetto, si apre in una nuova finestra
- Carica file JSONL locale: seleziona e carica direttamente un file `.jsonl` locale (fino a 500MB)
- Scarica log corrente: scarica il file di log JSONL di monitoraggio corrente
- Unisci log: combina più file di log JSONL in un'unica sessione per un'analisi unificata
- Visualizza Prompt utente: estrai e visualizza tutti gli input utente con tre modalità di visualizzazione — modalità Originale (contenuto grezzo), modalità Contesto (tag di sistema comprimibili), modalità Testo (solo testo semplice); i comandi slash (`/model`, `/context`, ecc.) vengono mostrati come voci indipendenti; i tag relativi ai comandi vengono automaticamente nascosti dal contenuto del Prompt
- Esporta prompt in TXT: esporta i prompt utente (solo testo, esclusi tag di sistema) in un file `.txt` locale

### Supporto multilingue

CC-Viewer supporta 18 lingue, con cambio automatico in base alla lingua del sistema:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## Licenza

MIT
