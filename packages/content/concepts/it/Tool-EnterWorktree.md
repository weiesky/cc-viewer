# EnterWorktree

Crea un worktree Git isolato su un nuovo branch, oppure commuta la sessione in un worktree esistente del repository corrente, così che il lavoro parallelo o sperimentale possa procedere senza toccare il checkout principale.

## Quando usare

- L'utente dice esplicitamente "worktree" — ad esempio "start a worktree", "create a worktree" o "work in a worktree".
- Le istruzioni di progetto in `CLAUDE.md` o nella memoria persistente indicano di usare un worktree per il compito corrente.
- Vuoi continuare un compito precedentemente configurato come worktree (passa `path` per rientrarci).
- Più branch sperimentali devono coesistere su disco senza un continuo cambio di checkout.
- Un compito a lunga esecuzione dovrebbe essere isolato da modifiche non correlate nel working tree principale.

## Parametri

- `name` (string, opzionale): Un nome per una nuova directory worktree. Ogni segmento separato da `/` può contenere solo lettere, cifre, punti, underscore e trattini; la stringa completa è limitata a 64 caratteri. Se omesso e anche `path` è omesso, viene generato un nome casuale. Mutuamente esclusivo con `path`.
- `path` (string, opzionale): Il percorso di filesystem di un worktree esistente del repository corrente su cui commutare. Deve apparire in `git worktree list` per questo repo; i percorsi che non sono worktree registrati del repo corrente vengono rifiutati. Mutuamente esclusivo con `name`.

## Esempi

### Esempio 1: Creare un nuovo worktree con un nome descrittivo

```
EnterWorktree(name="feat/okta-sso")
```

Crea `.claude/worktrees/feat/okta-sso` su un nuovo branch basato su `HEAD`, quindi commuta la working directory della sessione al suo interno. Tutte le modifiche ai file e i comandi shell successivi operano all'interno di quel worktree fino all'uscita.

### Esempio 2: Rientrare in un worktree esistente

```
EnterWorktree(path="/Users/me/repo/.claude/worktrees/feat/okta-sso")
```

Riprende il lavoro in un worktree precedentemente creato. Poiché ci sei entrato via `path`, `ExitWorktree` non lo eliminerà automaticamente — uscire con `action: "keep"` semplicemente riporta alla directory originale.

## Note

- Non chiamare `EnterWorktree` a meno che l'utente non l'abbia esplicitamente chiesto o le istruzioni di progetto lo richiedano. Normali cambi di branch o richieste di bug-fix dovrebbero usare comandi Git normali, non worktree.
- Quando invocato all'interno di un repository Git, il tool crea un worktree sotto `.claude/worktrees/` e registra un nuovo branch basato su `HEAD`. Al di fuori di un repository Git, delega agli hook configurati `WorktreeCreate` / `WorktreeRemove` in `settings.json` per isolamento VCS-agnostico.
- Solo una sessione worktree è attiva alla volta. Il tool rifiuta di funzionare se sei già dentro una sessione worktree; esci prima con `ExitWorktree`.
- Usa `ExitWorktree` per uscire a metà sessione. Se la sessione termina mentre sei ancora dentro un worktree appena creato, all'utente viene chiesto se mantenerlo o rimuoverlo.
- I worktree inseriti via `path` sono considerati esterni — `ExitWorktree` con `action: "remove"` non li eliminerà. È una protezione di sicurezza per proteggere i worktree che l'utente gestisce manualmente.
- Un nuovo worktree eredita i contenuti del branch corrente ma ha una working directory e un indice indipendenti. Le modifiche staged e unstaged nel checkout principale non sono visibili all'interno del worktree.
- Consiglio sui nomi: prefissa con il tipo di lavoro (`feat/`, `fix/`, `spike/`) così che più worktree concorrenti siano facili da distinguere in `git worktree list`.
