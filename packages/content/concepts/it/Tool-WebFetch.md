# WebFetch

Recupera i contenuti di una pagina web pubblica, converte l'HTML in Markdown ed esegue un piccolo modello ausiliario sul risultato usando un prompt in linguaggio naturale per estrarre le informazioni di cui hai bisogno.

## Quando usare

- Leggere una pagina di documentazione pubblica, un post di blog o un RFC referenziato nella conversazione.
- Estrarre un fatto specifico, uno snippet di codice o una tabella da un URL noto senza caricare l'intera pagina nel contesto.
- Riassumere note di release o changelog da una risorsa web aperta.
- Controllare il riferimento API pubblico di una libreria quando il sorgente non è nel repository locale.
- Seguire un link che l'utente ha incollato nella chat per rispondere a una domanda di follow-up.

## Parametri

- `url` (string, obbligatorio): Un URL assoluto completamente formato. Un semplice `http://` viene automaticamente aggiornato a `https://`.
- `prompt` (string, obbligatorio): L'istruzione passata al piccolo modello di estrazione. Descrivi esattamente cosa estrarre dalla pagina, come "list all exported functions" o "return the minimum supported Node version".

## Esempi

### Esempio 1: Estrarre un valore predefinito di configurazione

```
WebFetch(
  url="https://vitejs.dev/config/server-options.html",
  prompt="What is the default value of server.port and can it be a string?"
)
```

Il tool recupera la pagina docs di Vite, la converte in Markdown e restituisce una risposta breve come "Default is `5173`; accepts a number only."

### Esempio 2: Riassumere una sezione di changelog

```
WebFetch(
  url="https://nodejs.org/en/blog/release/v20.11.0",
  prompt="List the security fixes included in this release as bullet points."
)
```

Utile quando l'utente chiede "what changed in Node 20.11" e la pagina di release è lunga.

## Note

- `WebFetch` fallisce su qualsiasi URL che richieda autenticazione, cookie o VPN. Per Google Docs, Confluence, Jira, risorse GitHub private o wiki interni, usa invece un server MCP dedicato che fornisca accesso autenticato.
- Per qualsiasi cosa ospitata su GitHub (PR, issue, blob di file, risposte API), preferisci la CLI `gh` attraverso `Bash` piuttosto che fare scraping dell'UI web. `gh pr view`, `gh issue view` e `gh api` restituiscono dati strutturati e funzionano contro repository privati.
- I risultati possono essere riassunti quando la pagina recuperata è molto grande. Se hai bisogno di testo esatto, restringi il `prompt` per chiedere un estratto letterale.
- Una cache auto-pulente di 15 minuti è applicata per URL. Chiamate ripetute alla stessa pagina durante una sessione sono quasi istantanee ma possono restituire contenuto leggermente stantio. Se la freschezza importa, menzionalo nel prompt o aspetta la scadenza della cache.
- Se l'host target emette un redirect cross-host, il tool restituisce il nuovo URL in un blocco di risposta speciale e non lo segue automaticamente. Re-invoca `WebFetch` con il target del redirect se vuoi ancora il contenuto.
- Il prompt è eseguito da un modello più piccolo e veloce dell'assistente principale. Mantienilo stretto e concreto; il ragionamento complesso a più passi è meglio gestito leggendo tu stesso il Markdown grezzo dopo il fetch.
- Non passare mai segreti, token o identificatori di sessione incorporati nell'URL — i contenuti della pagina e le query string riflesse nell'output possono essere loggati da servizi upstream.
