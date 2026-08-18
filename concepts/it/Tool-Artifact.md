# Artifact

Renderizza un file HTML o Markdown in un Artifact — una pagina web ospitata su claude.ai che è privata per impostazione predefinita e che l'utente può aprire in un browser e successivamente scegliere di condividere. Usalo quando la comunicazione visiva supera il testo del terminale.

## Quando usare

- Pubblicare un deliverable visivo: un rapporto, un dashboard, un'investigazione di bug o un mockup UI
- Aggiornare una pagina precedentemente pubblicata in loco (stesso file path → stesso URL al ridistribuire)
- Elencare gli artifacts esistenti dell'utente per trovarne uno da una sessione precedente (`action: "list"`)
- **Non** per contenuti che devono rimanere locali, risposte in testo semplice o qualsiasi cosa che necessiti risorse di rete esterne durante la visualizzazione — una CSP rigida blocca ogni host esterno

## Attivazione

- Richiede un piano Pro, Max, Team o Enterprise con login claude.ai (`/login`).
- Solo Anthropic API — non disponibile su Amazon Bedrock, Google Cloud o Microsoft Foundry.
- Richiede Claude Code ≥ 2.1.183 o l'app Desktop ≥ 1.13576.0.
- Disattivalo con l'impostazione `disableArtifact` o `CLAUDE_CODE_DISABLE_ARTIFACT=1`.

## Parametri

- `file_path` (stringa): Percorso del file `.html` o `.md` da renderizzare. Il file viene avvolto in uno scheletro di documento al momento della pubblicazione, quindi scrivi il contenuto della pagina direttamente — nessun tag `<!DOCTYPE>`, `<html>`, `<head>` o `<body>`. Stesso percorso → stesso URL al ridistribuire; un percorso diverso rivendica un nuovo URL.
- `favicon` (stringa, obbligatorio per pubblicare): Uno o due emoji usati come icona di scheda del browser (es. `"📊"`). Solo emoji, nessun markup. Mantienilo coerente tra i ridistribuimenti — gli utenti trovano la loro scheda dall'icona.
- `description` (stringa): Un sottotitolo di una sola frase mostrato sulla scheda della galleria degli artifacts.
- `url` (stringa, facoltativo): Passa l'URL di un artifact esistente per aggiornarlo da una conversazione che non l'ha pubblicato. Senza questo, una nuova conversazione crea sempre un nuovo URL.
- `label` (stringa, facoltativo): Nome della versione breve e leggibile (max 60 caratteri) mostrato nel selettore di versione.
- `action` (stringa, facoltativo): `"publish"` (default) o `"list"` — elenca gli artifacts pubblicati dell'utente (titolo, URL, ultimo aggiornamento), opzionalmente con `limit`.
- `force` (booleano, facoltativo): Sovrascrivi senza controllo di conflitto. Solo dopo un 409 da scrittura concorrente, una volta riconciliato.

## Note

- **Solo autocontenuto.** Una CSP rigida blocca le richieste a ogni host esterno — script CDN, fogli di stile esterni, immagini remote, fetch/WebSockets. Incorpora tutto il CSS/JS e includi le risorse come URI `data:`.
- **Responsivo e consapevole del tema.** Le pagine vengono renderizzate nel tema chiaro o scuro dell'utente; formatta entrambi (`prefers-color-scheme` più l'override `data-theme` dell'utente). Il contenuto ampio scorre nel suo contenitore — il corpo della pagina non deve mai scorrere orizzontalmente.
- **Aggiornare tra conversazioni richiede `url`.** Ridistribuire lo stesso percorso di file riutilizza solo l'URL all'interno della conversazione che l'ha pubblicato; per mantenere il link di un artifact precedente, trova il suo URL con `action: "list"` e passalo come `url`.
- **Pubblicare è rivolto all'esterno.** Il contenuto inviato al servizio di artifacts può essere memorizzato nella cache anche se eliminato successivamente — non pubblicare nulla che deve rimanere privato sulla macchina.
- **Rileggi con WebFetch.** Gli URL degli artifacts di claude.ai possono essere recuperati tramite WebFetch (non curl, che ottiene la shell dell'app).
