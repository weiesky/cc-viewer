# CC-Viewer

Un sistema di monitoraggio delle richieste per Claude Code che cattura e visualizza tutte le richieste e risposte API in tempo reale. Aiuta gli sviluppatori a monitorare il proprio Context per la revisione e il debug durante il Vibe Coding.

[简体中文](../README.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Utilizzo

```bash
npm install -g cc-viewer
```

Dopo l'installazione, eseguire:

```bash
ccv
```

Questo comando configura automaticamente il Claude Code installato localmente per il monitoraggio e aggiunge un hook di riparazione automatica nella configurazione della shell (`~/.zshrc` o `~/.bashrc`). Quindi utilizzare Claude Code come al solito e aprire `http://localhost:7008` nel browser per visualizzare l'interfaccia di monitoraggio.

Dopo un aggiornamento di Claude Code, non è necessaria alcuna azione manuale — al prossimo avvio di `claude`, il rilevamento e la riconfigurazione avverranno automaticamente.

### Disinstallazione

```bash
ccv --uninstall
```

## Funzionalità

### Monitoraggio delle richieste (Raw Mode)

- Cattura in tempo reale di tutte le richieste API da Claude Code, incluse le risposte in streaming
- Il pannello sinistro mostra il metodo di richiesta, URL, durata e codice di stato
- Identificazione ed etichettatura automatica delle richieste Main Agent e Sub Agent
- Il pannello destro supporta il passaggio tra le schede Request / Response
- Il Request Body espande `messages`, `system`, `tools` di un livello per impostazione predefinita
- Il Response Body completamente espanso per impostazione predefinita
- Passaggio tra vista JSON e vista testo semplice
- Copia del contenuto JSON con un clic
- Le richieste MainAgent supportano Body Diff JSON, mostrando in modo compresso le differenze con la richiesta MainAgent precedente (solo campi modificati/aggiunti)

### Chat Mode

Fare clic sul pulsante "Chat mode" in alto a destra per analizzare la cronologia completa delle conversazioni del Main Agent in un'interfaccia di chat:

- Messaggi dell'utente allineati a destra (bolle blu), risposte del Main Agent allineate a sinistra (bolle scure) con rendering Markdown
- Messaggi `/compact` rilevati automaticamente e mostrati compressi, fare clic per espandere il riepilogo completo
- Risultati delle chiamate agli strumenti visualizzati in linea all'interno del messaggio Assistant corrispondente
- Blocchi `thinking` compressi per impostazione predefinita, fare clic per espandere
- `tool_use` mostrato come schede compatte di chiamata strumenti (Bash, Read, Edit, Write, Glob, Grep, Task hanno ciascuno visualizzazioni dedicate)
- Messaggi di selezione dell'utente (AskUserQuestion) mostrati in formato domanda e risposta
- Tag di sistema (`<system-reminder>`, `<project-reminder>`, ecc.) auto-compressi
- Testo di sistema auto-filtrato, mostrando solo l'input reale dell'utente
- Visualizzazione segmentata multi-sessione (segmentazione automatica dopo `/compact`, `/clear`, ecc.)
- Ogni messaggio mostra un timestamp preciso al secondo

### Statistiche Token

Pannello al passaggio del mouse nell'area dell'intestazione:

- Conteggio Token raggruppato per modello (input/output)
- Contatori di creazione/lettura Cache e tasso di successo della Cache
- Conto alla rovescia della scadenza della Cache del Main Agent

### Gestione dei Log

Tramite il menu a tendina CC-Viewer in alto a sinistra:

- Importa log locali: sfoglia i file di log storici, raggruppati per progetto, si apre in una nuova finestra
- Carica file JSONL locale: seleziona e carica direttamente un file `.jsonl` locale (fino a 200 MB)
- Scarica log corrente: scarica il file di log JSONL di monitoraggio corrente
- Esporta prompt utente: estrai e visualizza tutti gli input dell'utente, con vista comprimibile dei system-reminder
- Esporta prompt in TXT: esporta i prompt utente in un file `.txt` locale

### Supporto multilingue

CC-Viewer supporta 18 lingue, con cambio automatico in base alla lingua del sistema:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## Licenza

MIT
