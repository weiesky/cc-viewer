# SubAgent: Search

## Scopo

Il subagente Search è un agente di esplorazione leggero e in sola lettura. Invialo quando hai bisogno di comprendere un codebase — trovare dove vive qualcosa, imparare come i componenti si incastrano o rispondere a domande strutturali — senza cambiare alcun file. È ottimizzato per molte piccole letture su molti file, restituendo un riepilogo conciso piuttosto che output di ricerca grezzi.

Search non è un assistente general-purpose. Non può modificare codice, eseguire build, committare modifiche o aprire connessioni di rete oltre fetch in sola lettura. Il suo valore è che può bruciare un grande budget di esplorazione in parallelo senza consumare il contesto dell'agente principale, e poi restituire una risposta compatta.

## Quando usare

- Devi rispondere a una domanda che richiede tre o più ricerche o letture distinte. Esempio: "How is authentication wired from the login route down to the session store?"
- Il target è sconosciuto — non sai ancora quale file, modulo o simbolo guardare.
- Hai bisogno di una panoramica strutturale di un'area sconosciuta del repo prima di fare modifiche.
- Vuoi fare riferimento incrociato a più candidati (ad esempio, quale di diversi helper nominati in modo simile è effettivamente chiamato in produzione).
- Hai bisogno di un riepilogo in stile letterario: "list every place that imports X and categorise by call site."

Non usare Search quando:

- Conosci già il file e la riga esatti. Chiama direttamente `Read`.
- Un singolo `Grep` o `Glob` risponderà alla domanda. Eseguilo direttamente; inviare un subagente aggiunge overhead.
- Il compito richiede editing, esecuzione di comandi o qualsiasi effetto collaterale. Search è in sola lettura per design.
- Hai bisogno dell'output verbatim esatto di una chiamata tool. I subagenti riassumono; non fanno da proxy per risultati grezzi.

## Livelli di accuratezza

Scegli il livello che corrisponde all'importanza della domanda.

- `quick` — alcune ricerche mirate, risposta best-effort. Usa quando hai bisogno di un puntatore rapido (ad esempio, "where is the env-var parsing logic?") e sei a tuo agio a iterare se la risposta è incompleta.
- `medium` — il default. Diversi cicli di ricerca, verifica incrociata dei candidati e lettura completa dei file più rilevanti. Usa per domande tipiche "help me understand this area".
- `very thorough` — esplorazione esaustiva. Il subagente inseguirà ogni traccia plausibile, leggerà il contesto circostante e ricontrollerà i risultati prima di riassumere. Usa quando la correttezza è importante (ad esempio, security review, pianificazione di migrazione) o quando una risposta incompleta causerà rilavoro.

Un'accuratezza più alta costa più tempo e token all'interno del subagente, ma quei token restano all'interno del subagente — solo il riepilogo finale ritorna all'agente principale.

## Tool disponibili

Search ha accesso a tutti i tool in sola lettura che l'agente principale usa, e nient'altro:

- `Read` — per leggere file specifici, inclusi intervalli parziali.
- `Grep` — per ricerche di contenuto attraverso l'albero.
- `Glob` — per localizzare file per pattern di nome.
- `Bash` in modalità sola lettura — per comandi che ispezionano lo stato senza mutarlo (ad esempio `git log`, `git show`, `ls`, `wc`).
- `WebFetch` e `WebSearch` — per leggere documentazione esterna quando quel contesto è richiesto.

Tool di editing (`Write`, `Edit`, `NotebookEdit`), comandi shell che modificano stato e tool di task-graph (`TaskCreate`, `TaskUpdate` e così via) sono deliberatamente non disponibili.

## Note

- Dai al subagente Search una domanda specifica, non un argomento. "List every caller of `renderMessage` and note which ones pass a custom theme" restituisce una risposta utile; "tell me about rendering" no.
- Il subagente restituisce un riepilogo. Se hai bisogno di percorsi di file esatti, richiedili esplicitamente nel tuo prompt.
- Più domande indipendenti sono meglio inviate come subagenti Search paralleli piuttosto che un lungo prompt, così che ciascuna possa concentrarsi.
- Poiché Search non può editare, abbinalo a un passo di edit di follow-up nell'agente principale una volta che sai cosa cambiare.
- Tratta l'output di Search come evidenza, non verità assoluta. Per qualsiasi cosa di carico portante, apri tu stesso i file citati prima di agire.
