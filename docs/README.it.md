# CC-Viewer

Sistema di monitoraggio delle richieste di Claude Code, che cattura e visualizza in tempo reale tutte le richieste e risposte API (testo originale, senza tagli). Pensato per aiutare gli sviluppatori a monitorare il proprio Context, facilitando la revisione e il debug durante il Vibe Coding.
L'ultima versione di CC-Viewer offre anche soluzioni per il deploy su server con programmazione web, oltre a strumenti per la programmazione da dispositivi mobili. Siete invitati a utilizzarlo nei vostri progetti; in futuro saranno disponibili ulteriori funzionalita tramite plugin e supporto per il deploy in cloud.

Iniziamo dalla parte interessante -- ecco come appare su dispositivi mobili:

<img width="1700" height="790" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | Italiano | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Utilizzo

### Installazione

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

### Modalita programmazione

ccv e un sostituto diretto di claude -- tutti i parametri vengono passati a claude, avviando contemporaneamente il Web Viewer.

```bash
ccv                    # == claude (modalita interattiva)
ccv -c                 # == claude --continue (continua l'ultima conversazione)
ccv -r                 # == claude --resume (riprendi conversazione)
ccv -p "hello"         # == claude --print "hello" (modalita stampa)
ccv --d                # == claude --dangerously-skip-permissions (scorciatoia)
ccv --model opus       # == claude --model opus
```

Il comando che l'autore usa abitualmente e:
```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
```

Dopo l'avvio della modalita programmazione, la pagina web si aprira automaticamente.

Puoi utilizzare Claude direttamente dalla pagina web, visualizzando contemporaneamente i messaggi completi delle richieste e le modifiche al codice.

E, cosa ancora piu interessante, puoi persino programmare dal tuo dispositivo mobile!


### Modalita logger

⚠️ Se preferisci ancora utilizzare lo strumento nativo claude o il plugin VS Code, usa questa modalita.

In questa modalita, avviando ```claude``` o ```claude --dangerously-skip-permissions```

verra automaticamente avviato un processo di log per registrare le richieste in ~/.claude/cc-viewer/*tuoprogetto*/date.jsonl

Avvia la modalita logger:
```bash
ccv -logger
```

Quando la console non puo stampare la porta specifica, la prima porta di avvio predefinita e 127.0.0.1:7008. Se esistono piu istanze, le porte successive sono 7009, 7010, ecc.

Il comando rileva automaticamente la modalita di installazione locale di Claude Code (NPM o Native Install) e si adatta di conseguenza.

- **Versione NPM di Claude Code**: inietta automaticamente lo script di intercettazione nel `cli.js` di Claude Code.
- **Versione Native di Claude Code**: rileva automaticamente il binario `claude`, configura un proxy trasparente locale e imposta uno Zsh Shell Hook per il reindirizzamento automatico del traffico.
- Per questo progetto si consiglia l'installazione di Claude Code tramite NPM.

Disinstalla la modalita logger:
```bash
ccv --uninstall
```

### Risoluzione dei problemi (Troubleshooting)

Se riscontri problemi di avvio, ecco una soluzione definitiva:
Primo passo: apri Claude Code in una directory qualsiasi;
Secondo passo: dai a Claude Code la seguente istruzione:
```
Ho installato il pacchetto npm cc-viewer, ma dopo aver eseguito ccv non funziona correttamente. Esamina cli.js e findcc.js di cc-viewer e, in base all'ambiente specifico, adatta la modalita di deploy locale di Claude Code. Le modifiche dovrebbero essere limitate il piu possibile a findcc.js.
```
Lasciare che Claude Code verifichi gli errori da solo e piu efficace che consultare chiunque o leggere qualsiasi documentazione!

Una volta completata l'istruzione, findcc.js verra aggiornato. Se il tuo progetto richiede frequentemente il deploy locale, o se il codice forkato deve risolvere spesso problemi di installazione, conserva questo file e copialo direttamente la prossima volta. Attualmente molti progetti e aziende non utilizzano Claude Code su Mac, ma lo ospitano su server, quindi l'autore ha separato findcc.js per facilitare il tracciamento degli aggiornamenti del codice sorgente di cc-viewer.

### Altri comandi ausiliari

Consulta l'aiuto:
```bash
ccv -h
```

### Override della configurazione (Configuration Override)

Se hai bisogno di utilizzare un endpoint API personalizzato (ad esempio un proxy aziendale), basta configurarlo in `~/.claude/settings.json` o impostare la variabile d'ambiente `ANTHROPIC_BASE_URL`. `ccv` lo rilevera automaticamente e inoltrera correttamente le richieste.

### Modalita silenziosa (Silent Mode)

Per impostazione predefinita, `ccv` opera in modalita silenziosa quando avvolge l'esecuzione di `claude`, mantenendo l'output del terminale pulito e coerente con l'esperienza nativa. Tutti i log vengono catturati in background e sono consultabili su `http://localhost:7008`.

Una volta configurato, basta utilizzare normalmente il comando `claude`. Visita `http://localhost:7008` per accedere all'interfaccia di monitoraggio.


## Versione client

CC-Viewer offre una versione client desktop scaricabile da GitHub:
[Link per il download](https://github.com/weiesky/cc-viewer/releases)
La versione client e attualmente in fase di test; non esitate a segnalare eventuali problemi. Inoltre, l'uso di cc-viewer richiede che Claude Code sia installato localmente.
E importante sottolineare che cc-viewer e semplicemente un "vestito" per l'operaio (Claude Code). Senza Claude Code, il vestito non puo funzionare da solo.


## Funzionalita


### Modalita programmazione

Dopo aver avviato ccv puoi vedere:

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />


Puoi visualizzare direttamente il diff del codice dopo aver completato la modifica:

<img width="1500" height="728" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

Anche se puoi aprire i file e programmare manualmente, non e consigliato -- quella e programmazione antica!

### Programmazione mobile

Puoi persino scansionare un QR code per programmare su dispositivi mobili:

<img width="3018" height="1460" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

Realizza la tua idea di programmazione mobile. Inoltre, e disponibile un meccanismo di plugin -- se hai bisogno di personalizzare in base alle tue abitudini di programmazione, puoi seguire gli aggiornamenti degli hooks dei plugin in futuro.

### Modalita logger (visualizza la conversazione completa di Claude Code)

<img width="1500" height="768" alt="image" src="https://github.com/user-attachments/assets/a8a9f3f7-d876-4f6b-a64d-f323a05c4d21" />


- Cattura in tempo reale tutte le richieste API inviate da Claude Code, garantendo il testo originale e non log censurati (questo e molto importante!!!)
- Identifica e contrassegna automaticamente le richieste Main Agent e Sub Agent (sottotipi: Plan, Search, Bash)
- Le richieste MainAgent supportano Body Diff JSON, visualizzazione compressa delle differenze rispetto alla richiesta MainAgent precedente (mostra solo campi modificati/aggiunti)
- Ogni richiesta mostra inline le statistiche di utilizzo dei Token (Token di input/output, creazione/lettura cache, tasso di hit)
- Compatibile con Claude Code Router (CCR) e altri scenari proxy -- corrispondenza fallback tramite pattern del percorso API

### Modalita conversazione

Cliccando sul pulsante "Modalita conversazione" in alto a destra, la cronologia completa della conversazione del Main Agent viene visualizzata come interfaccia chat:

<img width="1500" height="764" alt="image" src="https://github.com/user-attachments/assets/725b57c8-6128-4225-b157-7dba2738b1c6" />


- Al momento non supporta la visualizzazione di Agent Team
- Messaggi utente allineati a destra (bolla blu), risposte Main Agent allineate a sinistra (bolla scura)
- I blocchi `thinking` sono compressi per impostazione predefinita, renderizzati in Markdown, clicca per espandere e visualizzare il processo di pensiero; supporta traduzione con un clic (funzionalita ancora instabile)
- Messaggi di scelta utente (AskUserQuestion) visualizzati in formato domanda-risposta
- Sincronizzazione bidirezionale: passando alla modalita conversazione si posiziona automaticamente sulla conversazione corrispondente alla richiesta selezionata; tornando alla modalita originale si posiziona automaticamente sulla richiesta selezionata
- Pannello impostazioni: permette di cambiare lo stato di compressione predefinito dei risultati degli strumenti e dei blocchi di pensiero
- Navigazione conversazione su mobile: in modalita CLI mobile, cliccando sul pulsante "Navigazione conversazione" nella barra superiore, si apre una vista conversazione di sola lettura per navigare la cronologia completa su mobile

### Strumenti statistici

Pannello flottante "Statistiche dati" nell'area Header:

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/a3d2db47-eac3-463a-9b44-3fa64994bf3b" />

- Mostra il numero di cache creation/read e il tasso di hit della cache
- Statistiche di ricostruzione cache: raggruppate per causa (TTL, modifiche system/tools/model, troncamento/modifica messaggi, modifica key) con conteggio e token cache_creation
- Statistiche utilizzo strumenti: mostra la frequenza di chiamata di ogni strumento, ordinata per numero di chiamate
- Statistiche utilizzo Skill: mostra la frequenza di chiamata di ogni Skill, ordinata per numero di chiamate
- Supporto per le statistiche dei teammate
- Icona di aiuto concettuale (?): clicca per consultare la documentazione integrata di MainAgent, CacheRebuild e dei vari strumenti

### Gestione log

Tramite il menu a tendina CC-Viewer in alto a sinistra:
<img width="1500" height="760" alt="image" src="https://github.com/user-attachments/assets/33295e2b-f2e0-4968-a6f1-6f3d1404454e" />

**Compressione dei log**
Per quanto riguarda i log, l'autore desidera precisare che non sono state modificate le definizioni ufficiali di Anthropic, per garantire l'integrita dei log.
Tuttavia, poiche i singoli log di 1M Opus possono diventare estremamente grandi nelle fasi avanzate, grazie ad alcune ottimizzazioni sui log MainAgent, l'autore ha potuto ridurre la dimensione di almeno il 66% senza gzip.
Il metodo per analizzare questi log compressi puo essere estratto dal repository attuale.

### Altre funzionalita utili

<img width="1500" height="767" alt="image" src="https://github.com/user-attachments/assets/add558c5-9c4d-468a-ac6f-d8d64759fdbd" />

Puoi localizzare rapidamente il tuo prompt tramite gli strumenti nella barra laterale

---

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/82b8eb67-82f5-41b1-89d6-341c95a047ed" />

L'interessante KV-Cache-Text ti aiuta a vedere cio che Claude sta effettivamente vedendo

---

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/54cdfa4e-677c-4aed-a5bb-5fd946600c46" />

Puoi caricare immagini e descrivere le tue esigenze -- Claude ha un'eccellente capacita di comprensione delle immagini. E come sai, puoi incollare screenshot direttamente con Ctrl+V; nel dialogo viene mostrato il contenuto completo

---

<img width="600" height="370" alt="image" src="https://github.com/user-attachments/assets/87d332ea-3e34-4957-b442-f9d070211fbf" />

Puoi creare plugin personalizzati, gestire tutti i processi di CC-Viewer e CC-Viewer offre lo switching a caldo di interfacce di terze parti (si, puoi usare GLM, Kimi, MiniMax, Qwen, DeepSeek -- anche se l'autore ritiene che attualmente siano ancora piuttosto deboli)

---


<img width="1500" height="746" alt="image" src="https://github.com/user-attachments/assets/b1f60c7c-1438-4ecc-8c64-193d21ee3445" />

Altre funzionalita aspettano di essere scoperte... ad esempio: il sistema supporta Agent Team e include un Code Reviewer integrato. L'integrazione del Code Reviewer di Codex e in arrivo (l'autore raccomanda vivamente di usare Codex per fare Code Review di Claude Code)


### Aggiornamento automatico

CC-Viewer verifica automaticamente la disponibilita di aggiornamenti all'avvio (al massimo una volta ogni 4 ore). All'interno della stessa versione major (ad esempio 1.x.x -> 1.y.z) l'aggiornamento e automatico e diventa effettivo al prossimo avvio. Per aggiornamenti cross-major viene mostrata solo una notifica.

L'aggiornamento automatico segue la configurazione globale di Claude Code `~/.claude/settings.json`. Se Claude Code ha disabilitato gli aggiornamenti automatici (`autoUpdates: false`), anche CC-Viewer saltera l'aggiornamento automatico.

### Supporto multilingua

CC-Viewer supporta 18 lingue, con cambio automatico in base alla lingua del sistema:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
