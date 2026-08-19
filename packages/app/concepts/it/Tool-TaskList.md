# TaskList

Restituisce ogni task nel team corrente (o sessione) in forma riassuntiva. Usalo per esaminare il lavoro in sospeso, decidere cosa prendere in carico successivamente ed evitare di creare duplicati.

## Quando usare

- All'inizio di una sessione per vedere cosa è già tracciato.
- Prima di chiamare `TaskCreate`, per confermare che il lavoro non sia già catturato.
- Quando decidi quale task rivendicare successivamente come teammate o subagente.
- Per verificare le relazioni di dipendenza attraverso il team a colpo d'occhio.
- Periodicamente durante sessioni lunghe per risincronizzarsi con i teammate che potrebbero aver rivendicato, completato o aggiunto task.

`TaskList` è in sola lettura ed economico; chiamalo liberamente ogni volta che hai bisogno di una panoramica.

## Attivazione

- Disponibile per default sulla maggior parte dei modelli.
- Non disponibile su Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 e famiglie successive (v2.1.233+), salvo opt-in tramite `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` o `--tools`.
- L'intero sistema dei task è disabilitato quando `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parametri

`TaskList` non accetta parametri. Restituisce sempre l'insieme completo dei task per il contesto attivo.

## Forma della risposta

Ogni task nella lista è un riepilogo, non il record completo. Attendi approssimativamente:

- `id` — identificatore stabile da usare con `TaskGet` / `TaskUpdate`.
- `subject` — titolo imperativo breve.
- `status` — uno tra `pending`, `in_progress`, `completed`, `deleted`.
- `owner` — handle di agente o teammate, o vuoto quando non rivendicato.
- `blockedBy` — array di ID task che devono completarsi prima.

Per la descrizione completa, i criteri di accettazione o i metadati di un task specifico, segui con `TaskGet`.

## Esempi

### Esempio 1

Controllo rapido dello stato.

```
TaskList()
```

Scansiona l'output per qualsiasi cosa `in_progress` senza un `owner` (lavoro stantio) e qualsiasi cosa `pending` con `blockedBy` vuoto (pronto da prendere).

### Esempio 2

Teammate che sceglie il prossimo task.

```
TaskList()
# Filtra a: status == pending AND blockedBy è vuoto AND owner è vuoto.
# Tra questi, preferisci l'ID più basso (i task sono tipicamente numerati in
# ordine di creazione, quindi gli ID più bassi sono più vecchi e di solito
# di priorità più alta).
TaskGet(taskId: "<chosen id>")
TaskUpdate(taskId: "<chosen id>", status: "in_progress", owner: "<your handle>")
```

## Note

- Euristica teammate: quando più task `pending` sono sbloccati e senza proprietario, scegli l'ID più basso. Questo mantiene il lavoro FIFO ed evita che due agenti afferrino lo stesso task di alto profilo.
- Rispetta `blockedBy`: non iniziare un task i cui blocker sono ancora `pending` o `in_progress`. Lavora prima sul blocker o coordinati con il suo proprietario.
- `TaskList` è l'unico meccanismo di scoperta per i task. Non esiste ricerca; se la lista è lunga, scansiona strutturalmente (per stato, poi per proprietario).
- I task eliminati possono ancora apparire nella lista con stato `deleted` per tracciabilità. Ignorali per scopi di pianificazione.
- La lista riflette lo stato live del team, quindi i teammate possono aggiungere o rivendicare task tra le chiamate. Rielenca prima di rivendicare se è passato del tempo.
