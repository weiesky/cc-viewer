# WebSearch

Esegue una ricerca web live e restituisce risultati classificati che l'assistente usa per fondare la sua risposta su informazioni correnti oltre il cutoff di addestramento del modello.

## Quando usare

- Rispondere a domande su eventi attuali, release recenti o notizie dell'ultima ora.
- Cercare l'ultima versione di una libreria, framework o strumento CLI.
- Trovare documentazione o post di blog quando l'URL esatto è sconosciuto.
- Verificare un fatto che potrebbe essere cambiato da quando il modello è stato addestrato.
- Scoprire più prospettive su un argomento prima di recuperare qualsiasi singola pagina con `WebFetch`.

## Attivazione

- La disponibilità dipende da provider e modello: disponibile sull'Anthropic API e su Claude Platform on AWS; su Microsoft Foundry richiede un deployment ospitato da Anthropic; su Google Cloud funziona con i modelli Claude 4+.
- Non disponibile su Amazon Bedrock.
- Limita a 200 chiamate per sessione con `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`.

## Parametri

- `query` (string, obbligatorio): La query di ricerca. Lunghezza minima 2 caratteri. Includi l'anno corrente quando chiedi informazioni "più recenti" o "recenti" così che i risultati siano freschi.
- `allowed_domains` (array of strings, opzionale): Restringe i risultati solo a questi domini, ad esempio `["nodejs.org", "developer.mozilla.org"]`. Utile quando ti fidi di una fonte specifica.
- `blocked_domains` (array of strings, opzionale): Esclude risultati da questi domini. Non passare lo stesso dominio sia a `allowed_domains` che a `blocked_domains`.

## Esempi

### Esempio 1: Ricerca di versione con l'anno corrente

```
WebSearch(
  query="React 19 stable release date 2026",
  allowed_domains=["react.dev", "github.com"]
)
```

Restituisce annunci ufficiali ed evita siti aggregatori di bassa qualità.

### Esempio 2: Escludere fonti rumorose

```
WebSearch(
  query="kubernetes ingress-nginx CVE April 2026",
  blocked_domains=["pinterest.com", "medium.com"]
)
```

Mantiene i risultati focalizzati su advisory dei vendor e tracker di sicurezza.

## Note

- Quando usi `WebSearch` in una risposta, devi aggiungere una sezione `Sources:` alla fine della tua risposta elencando ogni risultato citato come hyperlink Markdown nella forma `[Title](URL)`. È un requisito obbligatorio, non opzionale.
- `WebSearch` è disponibile solo per utenti negli Stati Uniti. Se il tool non è disponibile nella tua regione, ripiega su `WebFetch` contro un URL noto o chiedi all'utente di incollare contenuto rilevante.
- Ogni chiamata esegue la ricerca in un singolo round-trip — non puoi fare streaming o paginare. Affina la query se il primo set di risultati è fuori bersaglio.
- Il tool restituisce snippet e metadati, non contenuti di pagina completi. Per leggere in profondità un risultato specifico, segui con `WebFetch` usando l'URL restituito.
- Usa `allowed_domains` per imporre fonti autoritative per domande sensibili alla sicurezza come CVE o compliance, e `blocked_domains` per tagliare fuori le SEO farm che clonano la documentazione.
- Mantieni le query brevi e basate su parole chiave. Le domande in linguaggio naturale funzionano ma tendono a restituire risposte conversazionali piuttosto che fonti primarie.
- Non inventare URL basati sull'intuizione di ricerca — esegui sempre la ricerca e cita ciò che il tool ha effettivamente restituito.
