# ExitWorktree

Esce da una sessione di worktree creata in precedenza da `EnterWorktree` e riporta la sessione alla directory di lavoro originale. Questo strumento agisce esclusivamente sui worktree creati da `EnterWorktree` nella sessione corrente; se non è attiva alcuna sessione di questo tipo, la chiamata non ha effetto.

## Quando usare

- Il lavoro in un worktree isolato è terminato e si desidera tornare alla directory di lavoro principale.
- Un'attività in un worktree di branch di funzionalità è completata e, dopo il merge, si vuole ripulire il branch e la directory.
- Si desidera conservare il worktree per un uso successivo e tornare semplicemente alla directory originale senza eliminare nulla.
- Si vuole abbandonare un branch sperimentale o temporaneo senza lasciare artefatti su disco.
- È necessario avviare una nuova sessione `EnterWorktree`, il che richiede di uscire prima da quella corrente.

## Parametri

- `action` (stringa, obbligatorio): `"keep"` conserva la directory del worktree e il branch su disco per potervi tornare in seguito; `"remove"` elimina sia la directory sia il branch, eseguendo un'uscita pulita.
- `discard_changes` (booleano, opzionale, predefinito `false`): Rilevante solo quando `action` è `"remove"`. Se il worktree contiene file non committati o commit assenti dal branch originale, lo strumento rifiuta la rimozione a meno che `discard_changes` non sia impostato su `true`. La risposta di errore elenca le modifiche specifiche in modo da poter confermare con l'utente prima di richiamare lo strumento.

## Esempi

### Esempio 1: uscita pulita dopo il merge delle modifiche

Dopo aver terminato il lavoro in un worktree e aver eseguito il merge del branch nel main, chiama `ExitWorktree` con `action: "remove"` per eliminare la directory del worktree e il branch, e tornare alla directory di lavoro originale.

```
ExitWorktree(action: "remove")
```

### Esempio 2: eliminazione di un worktree temporaneo con codice sperimentale non committato

Se un worktree contiene modifiche sperimentali non committate da scartare completamente, tenta prima `action: "remove"`. Lo strumento rifiuterà e elencherà le modifiche non committate. Dopo aver confermato con l'utente che le modifiche possono essere scartate, richiama con `discard_changes: true`.

```
ExitWorktree(action: "remove", discard_changes: true)
```

## Note

- Questo strumento agisce esclusivamente sui worktree creati da `EnterWorktree` nella sessione corrente. Non influirà sui worktree creati con `git worktree add`, sui worktree di sessioni precedenti né sulla directory di lavoro normale se `EnterWorktree` non è mai stato chiamato — in questi casi la chiamata è priva di effetto.
- `action: "remove"` viene rifiutato se il worktree ha modifiche non committate o commit non presenti nel branch originale, a meno che non venga fornito esplicitamente `discard_changes: true`. Conferma sempre con l'utente prima di impostare `discard_changes: true`, poiché i dati non possono essere recuperati.
- Se una sessione tmux è collegata al worktree: con `remove` viene terminata; con `keep` continua a essere eseguita e il suo nome viene restituito affinché l'utente possa riconnettersi in seguito.
- Al termine di `ExitWorktree`, è possibile chiamare nuovamente `EnterWorktree` per avviare una nuova sessione di worktree.
