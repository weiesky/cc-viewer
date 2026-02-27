# CC-Viewer

Sistema di monitoraggio delle richieste per Claude Code, che cattura e visualizza in tempo reale tutte le richieste e risposte API (testo originale, senza troncature). Permette agli sviluppatori di monitorare il proprio Context per rivedere e diagnosticare problemi durante il Vibe Coding.

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | Italiano | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Utilizzo

### Installazione

```bash
npm install -g cc-viewer
```

### Esecuzione e configurazione automatica

```bash
ccv
```

Questo comando rileva automaticamente il metodo di installazione locale di Claude Code (NPM o Native Install) e si adatta di conseguenza.

- **Installazione NPM**: Inietta automaticamente lo script di intercettazione in `cli.js` di Claude Code.
- **Native Install**: Rileva automaticamente il binario `claude`, configura un proxy trasparente locale e imposta un Zsh Shell Hook per instradare automaticamente il traffico.

### Override della configurazione (Configuration Override)

Se è necessario utilizzare un endpoint API personalizzato (ad es. proxy aziendale), è sufficiente configurarlo in `~/.claude/settings.json` o impostare la variabile d'ambiente `ANTHROPIC_BASE_URL`. `ccv` riconoscerà automaticamente queste impostazioni e inoltrerà le richieste correttamente.

### Modalità silenziosa (Silent Mode)

Per impostazione predefinita, `ccv` viene eseguito in modalità silenziosa quando avvolge `claude`, garantendo che l'output del terminale rimanga pulito e identico all'esperienza nativa. Tutti i log vengono acquisiti in background e sono visibili su `http://localhost:7008`.

Una volta completata la configurazione, utilizzare il comando `claude` come al solito. Aprire `http://localhost:7008` per visualizzare l'interfaccia di monitoraggio.

### Risoluzione dei problemi (Troubleshooting)

- **Output misto (Mixed Output)**: Se si vedono log di debug `[CC-Viewer]` mescolati con l'output di Claude, aggiornare all'ultima versione (`npm install -g cc-viewer`).
- **Connessione rifiutata (Connection Refused)**: Assicurarsi che il processo in background `ccv` sia in esecuzione. L'esecuzione di `ccv` o `claude` (dopo l'installazione dell'hook) dovrebbe avviarlo automaticamente.
- **Nessun Body (Empty Body)**: Se si vede "No Body" nel visualizzatore, potrebbe essere dovuto a formati SSE non standard. Il visualizzatore ora supporta l'acquisizione di contenuti grezzi come fallback.

### Disinstallazione

```bash
ccv --uninstall
```

### Verifica versione

```bash
ccv --version
```

## Funzionalità

### Monitoraggio delle richieste (modalità testo originale)
<img width="1500" height="720" alt="image" src="https://github.com/user-attachments/assets/519dd496-68bd-4e76-84d7-2a3d14ae3f61" />
- Cattura in tempo reale di tutte le richieste API di Claude Code — testo originale, non log troncati (questo è importante!!!)
- Identificazione ed etichettatura automatica delle richieste Main Agent e Sub Agent (sottotipi: Bash, Task, Plan, General)
- Le richieste MainAgent supportano Body Diff JSON, mostrando in modo compresso le differenze con la richiesta MainAgent precedente (solo campi modificati/aggiunti)
- Statistiche di utilizzo Token inline per richiesta (token di input/output, creazione/lettura cache, tasso di successo)
- Compatibile con Claude Code Router (CCR) e altri scenari proxy — le richieste vengono rilevate tramite pattern del percorso API come fallback

### Modalità conversazione

Fare clic sul pulsante «Modalità conversazione» in alto a destra per analizzare la cronologia completa delle conversazioni del Main Agent come interfaccia di chat:
<img width="1500" height="730" alt="image" src="https://github.com/user-attachments/assets/c973f142-748b-403f-b2b7-31a5d81e33e6" />


- La visualizzazione degli Agent Team non è ancora supportata
- Messaggi dell'utente allineati a destra (bolle blu), risposte del Main Agent allineate a sinistra (bolle scure)
- I blocchi `thinking` sono compressi per impostazione predefinita, renderizzati in Markdown, fare clic per espandere e visualizzare il processo di pensiero; traduzione con un clic supportata (funzionalità ancora instabile)
- I messaggi di selezione dell'utente (AskUserQuestion) vengono visualizzati in formato domanda e risposta
- Sincronizzazione bidirezionale delle modalità: il passaggio alla modalità conversazione naviga automaticamente alla conversazione della richiesta selezionata; il ritorno alla modalità testo originale naviga automaticamente alla richiesta selezionata
- Pannello impostazioni: è possibile alternare lo stato di compressione predefinito dei risultati degli strumenti e dei blocchi di pensiero


### Strumenti di statistica

Pannello flottante «Statistiche dati» nell'area dell'intestazione:
<img width="1500" height="729" alt="image" src="https://github.com/user-attachments/assets/b23f9a81-fc3d-4937-9700-e70d84e4e5ce" />

- Visualizzazione dei contatori cache creation/read e del tasso di successo della cache
- Statistiche di ricostruzione della cache: raggruppate per motivo (TTL, cambio system/tools/model, troncamento/modifica messaggi, cambio key) con conteggio e token cache_creation
- Statistiche di utilizzo degli strumenti: frequenza di chiamata per strumento, ordinate per numero di chiamate
- Statistiche di utilizzo degli Skill: frequenza di chiamata per Skill, ordinate per numero di chiamate
- Icone di aiuto concettuale (?): fare clic per visualizzare la documentazione integrata di MainAgent, CacheRebuild e ogni strumento

### Gestione dei log

Tramite il menu a tendina CC-Viewer in alto a sinistra:
<img width="1200" height="672" alt="image" src="https://github.com/user-attachments/assets/8cf24f5b-9450-4790-b781-0cd074cd3b39" />

- Importa log locali: sfogliare i file di log storici, raggruppati per progetto, si apre in una nuova finestra
- Carica file JSONL locale: selezionare e caricare direttamente un file `.jsonl` locale (supporto fino a 500MB)
- Salva log corrente con nome: scaricare il file di log JSONL di monitoraggio corrente
- Unisci log: combinare più file di log JSONL in un'unica sessione per un'analisi unificata
- Visualizza Prompt utente: estrarre e visualizzare tutti gli input utente con tre modalità di visualizzazione — modalità Originale (contenuto grezzo), modalità Contesto (tag di sistema comprimibili), modalità Testo (solo testo); i comandi slash (`/model`, `/context`, ecc.) vengono mostrati come voci indipendenti; i tag relativi ai comandi vengono automaticamente nascosti dal contenuto del Prompt
- Esporta Prompt come TXT: esportare i Prompt utente (solo testo, senza tag di sistema) in un file `.txt` locale

### Supporto multilingue

CC-Viewer supporta 18 lingue, con cambio automatico in base alla lingua di sistema:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
