# CC-Viewer

🌐 **Sito web e tour delle funzionalità: [weiesky.github.io/cc-viewer](https://weiesky.github.io/cc-viewer/)** — disponibile in 18 lingue.


Un toolkit Vibe Coding distillato dall'esperienza di sviluppo personale, costruito su Claude Code:

1. Elevare il limite delle capacità: esegui /ultraPlan e /ultraReview localmente, in modo che il codice del tuo progetto non debba mai essere completamente esposto al cloud di Claude;
2. Compatibilità multipiattaforma: consente la programmazione mobile (all'interno della LAN); la versione web si adatta a vari scenari, facile da incorporare in estensioni del browser e viste suddivise del sistema operativo, e fornisce un installatore nativo;
3. Registrazione completa: offre capacità complete di intercettazione e analisi del payload di Claude Code, ideale per la registrazione, l'analisi dei problemi, l'apprendimento, l'ispirazione e il reverse engineering;
4. Apprendimento ed esperienza condivisi: sono stati accumulati numerosi materiali di studio ed esperienze di sviluppo (vedi le icone "?" in tutto il sistema);
5. Esperienza nativa preservata: estende solo le capacità di Claude Code, senza modifiche sostanziali al kernel, mantenendo l'esperienza nativa;
6. Supporto per modelli di terze parti: compatibile con deepseek-v4-\*, GLM 5.1, Kimi K2.6, con la capacità cc-switch integrata per commutare a caldo tra strumenti di terze parti in qualsiasi momento. La finestra di commutazione a caldo supporta anche sorgenti per ruolo — Main Agent, Sub-Agents e Teammates possono ciascuno usare un profilo proxy diverso (predefinito: seguire il Main Agent); quando il Main Agent usa il Default integrato con l'endpoint ufficiale, l'assegnazione dei ruoli resta nascosta e dormiente.

<img width="860" alt="cc-viewer — deploy once, share with every device" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-share.svg" />

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | Italiano | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Utilizzo

### Prerequisiti

* Assicurati di aver installato Node.js 20.0.0+; [Scarica e installa](https://nodejs.org)
* Assicurati di aver installato Claude Code; [Tutorial di installazione](https://github.com/anthropics/claude-code)

### Installare ccv

#### Installazione tramite npm

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

#### Installazione tramite Homebrew (consigliato per macOS / Linux)

```bash
brew tap weiesky/cc-viewer
brew install cc-viewer
brew upgrade cc-viewer   # per gli aggiornamenti — NON usare npm install -g con le installazioni brew
```

### Avvio

ccv è un sostituto diretto di claude — tutti gli argomenti vengono trasmessi a claude mentre viene avviato il Web Viewer.

```bash
ccv                    # == claude (modalità interattiva)
```

Il comando che l'autore stesso utilizza più spesso è:

```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
                       # ccv trasmette tutti i parametri di avvio di Claude Code — puoi combinarli come preferisci
```

Dopo l'avvio in modalità programmazione, si aprirà automaticamente una pagina web.

cc-viewer è anche distribuito come applicazione desktop nativa: [Pagina di download](https://github.com/weiesky/cc-viewer/releases)

### Aggiornamento a 1.7.0 (formato log v2)

Dalla versione 1.7.0, i log vengono archiviati in un formato a directory per sessione (wire-format v2) anziché in singoli file `.jsonl` — con un'occupazione su disco inferiore di circa il 90%. I file `.jsonl` v1 esistenti non vengono mai modificati né eliminati; la finestra di dialogo dei log elenca per impostazione predefinita le sessioni v2 e una piccola voce “Mostra log legacy (v1)” (visibile finché esistono vecchi file) apre una vista v1 in cui possono essere visualizzati, migrati o eliminati. All'avvio, cc-viewer offre una migrazione con un clic quando vengono rilevati log legacy (fortemente consigliata quando si prosegue una vecchia conversazione con `claude -c`, la cui prima metà risiede nei vecchi file). Puoi anche migrare dal terminale:

```bash
ccv convert <project>   # migra un singolo progetto
ccv convert --all       # migra tutti i progetti
ccv verify <v1-file>    # confronta un file v1 con le sue sessioni convertite
```

Se una sessione non supera la verifica golden, viene trattenuta in `sessions-quarantine/` per l'ispezione anziché far fallire l'intera migrazione: le altre sessioni vengono comunque migrate.

### Modalità Logger

Se preferisci ancora lo strumento nativo claude o l'estensione VS Code, usa questa modalità.

In questa modalità, l'avvio di `claude`

avvierà automaticamente un processo di registrazione che salva i log delle richieste in directory per sessione sotto \~/.claude/cc-viewer/*yourproject*/sessions/ (wire-format v2)

Abilitare la modalità logger:

```bash
ccv -logger
```

Quando la console non può stampare la porta specifica, la prima porta predefinita è 127.0.0.1:7008. Le istanze multiple utilizzano porte sequenziali come 7009, 7010.

Disinstallare la modalità logger:

```bash
ccv --uninstall
```

### Risoluzione dei problemi (Troubleshooting)

Se riscontri problemi all'avvio di cc-viewer, ecco l'approccio definitivo per la risoluzione dei problemi:
Passo 1: Apri Claude Code in qualsiasi directory.
Passo 2: Dai a Claude Code la seguente istruzione:

```
Ho installato il pacchetto npm cc-viewer, ma dopo aver eseguito ccv ancora non funziona correttamente. Controlla cli.js e findcc.js di cc-viewer e adattali al deployment locale di Claude Code in base all'ambiente specifico. Mantieni l'ambito delle modifiche il più possibile limitato a findcc.js.
```

Lasciare che Claude Code diagnostichi il problema da solo è più efficace che chiedere a chiunque o leggere qualsiasi documentazione!

Una volta completata l'istruzione precedente, findcc.js verrà aggiornato. Se il tuo progetto richiede frequentemente un deployment locale, o se il codice forkato deve spesso risolvere problemi di installazione, mantenere questo file ti permette semplicemente di copiarlo la volta successiva. Al momento, molti progetti e aziende che utilizzano Claude Code non distribuiscono su Mac ma in ambienti ospitati lato server, quindi l'autore ha separato il file findcc.js per facilitare il tracciamento degli aggiornamenti del codice sorgente di cc-viewer in futuro.

Nota: questa applicazione entra in conflitto con claude-code-switch e claude-code-router a causa della concorrenza del proxy, quindi quando la usi assicurati di chiudere claude-code-switch e claude-code-router. cc-viewer include una capacità di aggiornamento a caldo del proxy come sostituto equivalente.

### Altri comandi ausiliari

Consulta:

```bash
ccv -h
```

### Modalità silenziosa (Silent Mode)

Per impostazione predefinita, `ccv` viene eseguito in modalità silenziosa quando avvolge `claude`, mantenendo l'output del terminale pulito e coerente con l'esperienza nativa. Tutti i log vengono catturati in background e possono essere visualizzati su `http://localhost:7008`.

Una volta configurato, usa il comando `claude` normalmente. Visita `http://localhost:7008` per accedere all'interfaccia di monitoraggio.

## Funzionalità

### Modalità Programmazione

Dopo l'avvio con ccv, puoi vedere:

<img height="765" width="1500" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />

Puoi vedere le differenze di codice direttamente dopo la modifica:

<img height="728" width="1500" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

Anche se puoi aprire file e codificare manualmente, la programmazione manuale non è consigliata — è programmazione all'antica!

### Programmazione mobile

Puoi persino scansionare un codice QR per programmare dal tuo dispositivo mobile:

<img height="1460" width="3018" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

<img height="790" width="1700" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

Realizza la tua immaginazione della programmazione mobile. C'è anche un meccanismo di plugin — se hai bisogno di personalizzare in base alle tue abitudini di codifica, tieni d'occhio gli aggiornamenti degli hook dei plugin.

### Prompt di sistema per modello

La finestra modale **Modifica prompt di sistema** (menu hamburger → Modifica prompt di sistema) è organizzata in schede:

* La scheda **Predefinito** mantiene il comportamento classico: scrive `CC_SYSTEM.md` (sovrascrivi) o `CC_APPEND_SYSTEM.md` (aggiungi) nell'area di lavoro corrente, iniettato come `--system-prompt-file` / `--append-system-prompt-file` al successivo avvio di ccv.
* **Schede modello**: fai clic su **+ Aggiungi modello**, digita un nome come `opus` o `Gemini3` e scegli un ambito — **Globale** (`~/.claude/cc-viewer/system_prompt/`, si applica a ogni area di lavoro) o **Area di lavoro** (`<project>/system_prompt/`). Il campo del nome offre suggerimenti durante la digitazione basati sui modelli configurati localmente (profili proxy con ricarica a caldo e `settings.json`); i nomi già aggiunti nell'ambito scelto vengono nascosti e restano comunque consentiti nomi arbitrari in forma libera. Ogni scheda ha il proprio interruttore Aggiungi/Sovrascrivi e la propria anteprima Markdown.
* Le voci sono memorizzate come file in maiuscolo: `OPUS_SYSTEM.md` (sovrascrivi) o `OPUS_APPEND_SYSTEM.md` (aggiungi). La corrispondenza è fuzzy — una sottostringa, senza distinzione tra maiuscole e minuscole, dell'ID del modello risolto dalla configurazione ATTIVA (mappatura modello del proxy profile di terze parti attivo > variabili d'ambiente `ANTHROPIC_MODEL`/`CLAUDE_MODEL` all'avvio > `model` di `settings.json`; senza segnale di configurazione nessuna voce viene iniettata), quindi `opus` corrisponde a `claude-opus-4-8[1m]` indipendentemente dalla versione. Una corrispondenza dell'area di lavoro prevale su una globale; all'interno di un ambito vince il nome più lungo; una voce corrispondente sostituisce completamente i file di Predefinito per quell'avvio. Limitazioni note: il cambio di proxy profile a metà sessione viene rivalutato solo dopo il riavvio della sessione claude; un flag `--model` passato tramite argomenti extra non viene considerato.
* Salvare una scheda vuota elimina la voce. I cambi di modello effettuati a metà sessione si applicano al successivo riavvio. Imposta `CCV_DISABLE_AUTO_SYSTEM_PROMPT=1` per disabilitare ogni iniezione automatica. Puoi fare il commit di `<project>/system_prompt/` per condividere i prompt con il tuo team, oppure aggiungerlo a `.gitignore` per mantenerli privati.

### Modalità Logger (Visualizzare sessioni complete di Claude Code)

<img width="860" alt="cc-viewer — wire-level capture and packet decomposition" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-proxy.svg" />

* Cattura tutte le richieste API di Claude Code in tempo reale, garantendo il testo grezzo — non log censurati (questo è importante!!!)
* Identifica ed etichetta automaticamente le richieste Main Agent e Sub Agent (sottotipi: Plan, Search, Bash)
* Le richieste MainAgent supportano Body Diff JSON, mostrando le differenze ripiegate rispetto alla precedente richiesta MainAgent (solo campi modificati/nuovi)
* Ogni richiesta mostra le statistiche di utilizzo dei Token in linea (Token di input/output, creazione/lettura cache, tasso di successo)
* Compatibile con Claude Code Router (CCR) e altri scenari di proxy — ricorre al pattern del percorso API

<a href="https://www.star-history.com/?repos=weiesky%2Fcc-viewer&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&theme=dark&legend=top-left" />

    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&legend=top-left" />

    ![Star History Chart](https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&legend=top-left)
  </picture>
</a>

## License

MIT
