# Inquinamento del contesto dell'API di traduzione

## Contesto

CC-Viewer include una funzionalità di traduzione integrata (`POST /api/translate`) basata sull'API Messages di Anthropic. Nell'implementazione iniziale, le richieste di traduzione riutilizzavano le credenziali di autenticazione memorizzate nella cache della sessione di Claude Code — inclusi gli header `x-api-key` e `authorization`. Questo ha causato un problema sottile ma grave: i risultati delle traduzioni restituivano frequentemente contenuti irrilevanti.

## Causa principale

### Differenza fondamentale tra i due metodi di autenticazione

L'API di Anthropic supporta due metodi di autenticazione:

| Metodo | Header | Origine tipica | Caratteristiche |
|--------|--------|----------------|-----------------|
| Chiave API | `x-api-key: sk-ant-...` | Variabile d'ambiente / Console | Senza stato, ogni richiesta è indipendente |
| Token OAuth | `authorization: Bearer sessionToken` | Login con abbonamento Claude Code | Legato alla sessione, il server mantiene l'associazione del contesto |

La differenza chiave: **le chiavi API sono senza stato (stateless)** — ogni richiesta è completamente indipendente; mentre **i token di sessione OAuth sono con stato (stateful)** — il server di Anthropic associa le richieste che utilizzano lo stesso token allo stesso contesto di sessione.

### Catena di inquinamento

Quando Claude Code utilizza il login OAuth tramite abbonamento, il flusso di autenticazione si presenta così:

```
Conversazione principale Claude Code ──(authorization: Bearer sessionToken)──→ Anthropic API
                                                                                 ↑
Richiesta di traduzione CC-Viewer ──(authorization: Bearer sessionToken)──→ Anthropic API
```

Poiché le richieste di traduzione riutilizzavano lo stesso token di sessione, il server di Anthropic poteva associare le richieste di traduzione al contesto della conversazione principale di Claude Code. Questo causa:

1. **I risultati della traduzione sono influenzati dal contesto della conversazione principale**: Il prompt di sistema della richiesta di traduzione è "sei un traduttore", ma il contesto del server contiene ancora la cronologia della conversazione di Claude Code, potenzialmente interferendo con il modello
2. **La conversazione principale viene disturbata dalle richieste di traduzione**: Il contenuto delle richieste di traduzione (frammenti di testo dell'interfaccia) può essere iniettato nel contesto della conversazione principale, causando deviazioni nelle risposte di Claude Code
3. **Comportamento imprevedibile**: Poiché l'inquinamento del contesto è un comportamento lato server, il client non può rilevarlo né controllarlo

## Lezioni apprese

- **I token di sessione OAuth non sono "semplicemente un'altra chiave API"** — portano con sé lo stato lato server, riutilizzarli significa condividere il contesto
- **Le chiamate interne ai servizi dovrebbero utilizzare un'autenticazione indipendente e senza stato** per evitare l'associazione con le sessioni utente

## Riferimenti

- [Anthropic API Authentication Docs](https://docs.anthropic.com/en/api/getting-started)
- [Claude Code Authentication](https://support.claude.com/en/articles/12304248-managing-api-key-environment-variables-in-claude-code)
- [Anthropic Bans Subscription OAuth in Third-Party Apps](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)
- [Claude Code Authentication: API Keys, Subscriptions, and SSO](https://developertoolkit.ai/en/claude-code/quick-start/authentication/)
