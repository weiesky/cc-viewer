# Agent

Avvia un subagente autonomo di Claude Code con una propria finestra di contesto per gestire un compito mirato e restituire un unico risultato consolidato. È il meccanismo canonico per delegare ricerche aperte, lavoro in parallelo o collaborazione in team.

## Quando usare

- Ricerche aperte in cui non si sa ancora quali file siano rilevanti e si prevedono più cicli di `Glob`, `Grep` e `Read`.
- Lavoro indipendente in parallelo — lancia più agenti in un singolo messaggio per investigare concorrentemente aree distinte.
- Isolare esplorazioni rumorose dalla conversazione principale affinché il contesto del genitore resti compatto.
- Delegare a un tipo di subagente specializzato come `Explore`, `Plan`, `claude-code-guide` o `statusline-setup`.
- Istanziare un teammate nominato all'interno di un team attivo per lavoro multi-agente coordinato.

NON usare quando il file o il simbolo target è già noto — usa direttamente `Read`, `Grep` o `Glob`. Una consultazione a singolo passo tramite `Agent` spreca un'intera finestra di contesto e aggiunge latenza.

## Parametri

- `description` (string, obbligatorio): Etichetta breve di 3–5 parole che descrive il compito; mostrata nell'UI e nei log.
- `prompt` (string, obbligatorio): Il brief completo e autonomo che l'agente eseguirà. Deve includere tutto il contesto necessario, i vincoli e il formato di ritorno atteso.
- `subagent_type` (string, opzionale): Persona preimpostata come `general-purpose`, `Explore`, `Plan`, `claude-code-guide` o `statusline-setup`. Default: `general-purpose`.
- `run_in_background` (boolean, opzionale): Se true, l'agente viene eseguito in modo asincrono e il genitore può continuare a lavorare; i risultati vengono recuperati in seguito.
- `model` (string, opzionale): Sovrascrive il modello per questo agente — `opus`, `sonnet` o `haiku`. Default: il modello della sessione genitore.
- `isolation` (string, opzionale): Imposta a `worktree` per eseguire l'agente in un worktree git isolato così che le sue scritture su filesystem non collidano con il genitore.
- `team_name` (string, opzionale): Quando si istanzia in un team esistente, l'identificatore del team a cui l'agente si unirà.
- `name` (string, opzionale): Nome indirizzabile del teammate all'interno del team, usato come target `to` per `SendMessage`.

## Esempi

### Esempio 1: Ricerca di codice aperta

```
Agent(
  description="Find auth middleware",
  subagent_type="Explore",
  prompt="Locate every place in this repo where JWT verification is performed. Return a bulleted list of absolute file paths with a one-line note about each site's role. Do not modify any files."
)
```

### Esempio 2: Indagini indipendenti in parallelo

Lancia due agenti nello stesso messaggio — uno che ispeziona la pipeline di build, l'altro che revisiona il test harness. Ciascuno ottiene la propria finestra di contesto e restituisce un riepilogo. Raggrupparli in un unico blocco di chiamate tool li esegue concorrentemente.

### Esempio 3: Istanziare un teammate in un team attivo

```
Agent(
  description="Data layer specialist",
  team_name="refactor-crew",
  name="db-lead",
  prompt="You are db-lead on team refactor-crew. Audit all Prisma schema files and propose a migration plan. Use SendMessage to report findings to the team leader."
)
```

## Note

- Gli agenti non hanno memoria delle esecuzioni precedenti. Ogni invocazione parte da zero, quindi il `prompt` deve essere completamente autonomo — includi percorsi dei file, convenzioni, la domanda e la forma esatta della risposta attesa.
- L'agente restituisce esattamente un messaggio finale. Non può porre domande di chiarimento durante l'esecuzione, quindi l'ambiguità nel prompt diventa congettura nel risultato.
- Eseguire più agenti in parallelo è significativamente più veloce delle chiamate sequenziali quando i sottocompiti sono indipendenti. Raggruppali in un unico blocco di chiamate tool.
- Usa `isolation: "worktree"` ogni volta che un agente scriverà file e vuoi revisionare i cambiamenti prima di fonderli nel working tree principale.
- Preferisci `subagent_type: "Explore"` per ricognizione in sola lettura e `Plan` per il lavoro di progettazione; `general-purpose` è il default per compiti misti di lettura/scrittura.
- Gli agenti in background (`run_in_background: true`) si adattano a lavori a lunga esecuzione; evita il polling in un loop di sleep — il genitore viene notificato al completamento.
