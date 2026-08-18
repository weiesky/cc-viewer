# EndConversation

Termina la conversazione corrente e impedisce l'invio di qualsiasi ulteriore messaggio.

## Quando usare

- Solo per abusi prolungati da parte dell'utente, o quando l'utente richiede esplicitamente una dimostrazione di questo tool.

Questa è un'azione di ultima istanza: le regole del tool stesso richiedono di avvisare prima l'utente e di confermare prima dell'uso, e non deve mai essere usata in situazioni di autolesionismo o legate a danni.

## Attivazione

- Richiede Claude Code 2.1.213+ e un modello della famiglia Opus 4.8 / Sonnet 5 / Fable 5 o successiva.
- Solo sessioni terminale interattive — mai in modalità `--bare`, e mai disponibile ai subagenti.
- Non disponibile su Amazon Bedrock, Claude Platform on AWS, Vertex AI, Microsoft Foundry o gateway cloud.
- Richiede un feature flag lato server — la maggior parte delle sessioni non offre questo tool.

## Parametri

Questo tool non accetta parametri.

## Esempi

### Esempio 1: Terminare la conversazione

```
EndConversation()
```

Il flusso è in due passi: la prima chiamata restituisce un messaggio di riflessione; una seconda chiamata immediatamente dopo termina davvero la conversazione (`ended: true`).

## Note

- Fortemente gated: richiede un modello supportato, l'entrypoint CLI e un feature flag lato server — la maggior parte delle sessioni non offre questo tool.
- Una volta terminata, nessun ulteriore messaggio può essere inviato nella conversazione.
