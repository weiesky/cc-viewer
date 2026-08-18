# TaskUpdate

Modifica un task esistente — il suo stato, contenuto, proprietà, metadati o archi di dipendenza. È così che i task progrediscono attraverso il loro ciclo di vita e come il lavoro viene passato tra Claude Code, teammate e subagenti.

## Quando usare

- Far transitare un task attraverso il workflow di stato mentre ci lavori.
- Rivendicare un task assegnando te stesso (o un altro agente) come `owner`.
- Affinare il `subject` o la `description` una volta che impari di più sul problema.
- Registrare dipendenze appena scoperte con `addBlocks` / `addBlockedBy`.
- Allegare `metadata` strutturati come ID di ticket esterni o suggerimenti di priorità.

## Attivazione

- Disponibile per default sulla maggior parte dei modelli.
- Non disponibile su Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 e famiglie successive (v2.1.233+), salvo opt-in tramite `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` o `--tools`.
- L'intero sistema dei task è disabilitato quando `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parametri

- `taskId` (string, obbligatorio): Il task da modificare. Ottienilo da `TaskList` o `TaskCreate`.
- `status` (string, opzionale): Uno tra `pending`, `in_progress`, `completed`, `deleted`.
- `subject` (string, opzionale): Titolo imperativo sostitutivo.
- `description` (string, opzionale): Descrizione dettagliata sostitutiva.
- `activeForm` (string, opzionale): Testo spinner al presente continuo sostitutivo.
- `owner` (string, opzionale): Handle di agente o teammate che si assume la responsabilità del task.
- `metadata` (object, opzionale): Chiavi di metadati da fondere nel task. Imposta una chiave a `null` per eliminarla.
- `addBlocks` (array of strings, opzionale): ID di task che questo task blocca.
- `addBlockedBy` (array of strings, opzionale): ID di task che devono completarsi prima di questo.

## Workflow di stato

Il ciclo di vita è deliberatamente lineare: `pending` → `in_progress` → `completed`. `deleted` è terminale e usato per ritirare task su cui non si lavorerà mai.

- Imposta `in_progress` nel momento in cui inizi effettivamente il lavoro, non prima. Solo un task alla volta dovrebbe essere `in_progress` per un dato proprietario.
- Imposta `completed` solo quando il lavoro è completamente fatto — criteri di accettazione soddisfatti, test che passano, output scritto. Se appare un blocker, mantieni il task `in_progress` e aggiungi un nuovo task che descriva cosa deve essere risolto.
- Non marcare mai un task come `completed` quando i test stanno fallendo, l'implementazione è parziale o hai incontrato errori irrisolti.
- Usa `deleted` per task cancellati o duplicati; non riutilizzare un task per lavoro non correlato.

## Esempi

### Esempio 1

Rivendica un task e inizialo.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "in_progress",
  owner: "main-agent"
)
```

### Esempio 2

Completa il lavoro e registra una dipendenza di follow-up.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "completed"
)

TaskUpdate(
  taskId: "t_01FOLLOWUP...",
  addBlockedBy: ["t_01HXYZ..."]
)
```

## Note

- `metadata` si fonde chiave per chiave; passare `null` per una chiave la rimuove. Chiama prima `TaskGet` se non sei sicuro del contenuto corrente.
- `addBlocks` e `addBlockedBy` appendono archi; non rimuovono quelli esistenti. Modificare il grafo distruttivamente richiede un workflow dedicato — consulta il proprietario del team prima di riscrivere le dipendenze.
- Mantieni `activeForm` sincronizzato quando cambi `subject` così che il testo dello spinner continui a leggersi naturalmente.
- Non marcare un task come `completed` per silenziarlo. Se l'utente ha cancellato il lavoro, usa `deleted` con una breve motivazione in `description`.
- Leggi l'ultimo stato di un task con `TaskGet` prima di aggiornare — i teammate potrebbero averlo cambiato tra la tua ultima lettura e la tua scrittura.
