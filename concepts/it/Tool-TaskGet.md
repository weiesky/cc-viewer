# TaskGet

Recupera il record completo per un singolo task tramite ID, inclusa la sua descrizione, stato corrente, proprietario, metadati e archi di dipendenza. Usalo quando il riepilogo restituito da `TaskList` non è sufficiente per agire sul task.

## Quando usare

- Hai preso un task da `TaskList` e hai bisogno della descrizione completa prima di iniziare il lavoro.
- Stai per marcare un task come `completed` e vuoi ricontrollare i criteri di accettazione.
- Devi ispezionare quali task questo `blocks` o è `blockedBy` per decidere la mossa successiva.
- Stai indagando la storia — chi lo possiede, quali metadati sono stati allegati, quando ha cambiato stato.
- Un teammate o una sessione precedente ha fatto riferimento a un ID task e ti serve il contesto.

Preferisci `TaskList` quando hai solo bisogno di una scansione ad alto livello; riserva `TaskGet` al record specifico che intendi leggere attentamente o modificare.

## Attivazione

- Disponibile per default sulla maggior parte dei modelli.
- Non disponibile su Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 e famiglie successive (v2.1.233+), salvo opt-in tramite `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` o `--tools`.
- L'intero sistema dei task è disabilitato quando `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parametri

- `taskId` (string, obbligatorio): L'identificatore del task restituito da `TaskCreate` o `TaskList`. Gli ID sono stabili per tutta la vita del task.

## Esempi

### Esempio 1

Cerca un task che hai appena visto nella lista.

```
TaskGet(taskId: "t_01HXYZ...")
```

Campi di risposta tipici: `id`, `subject`, `description`, `activeForm`, `status`, `owner`, `blocks`, `blockedBy`, `metadata`, `createdAt`, `updatedAt`.

### Esempio 2

Risolvi le dipendenze prima di iniziare.

```
TaskGet(taskId: "t_01HXYZ...")
# Ispeziona blockedBy — se qualsiasi task referenziato è ancora pending
# o in_progress, lavora prima sul blocker.
```

## Note

- `TaskGet` è in sola lettura ed è sicuro chiamarlo ripetutamente; non cambia lo stato o la proprietà.
- Se `blockedBy` non è vuoto e contiene task che non sono `completed`, non iniziare questo task — risolvi prima i blocker (o coordinati con il loro proprietario).
- Il campo `description` può essere lungo. Leggilo per intero prima di agire; scorrere velocemente porta a criteri di accettazione mancati.
- Un `taskId` sconosciuto o cancellato restituisce un errore. Ri-esegui `TaskList` per scegliere un ID corrente.
- Se stai per modificare un task, chiama prima `TaskGet` per evitare di sovrascrivere campi che un teammate ha appena cambiato.
