# Bash

Esegue un comando shell all'interno di una working directory persistente e restituisce il suo stdout/stderr. È meglio riservarlo a operazioni che nessun tool dedicato di Claude Code può esprimere, come eseguire git, npm, docker o script di build.

## Quando usare

- Eseguire operazioni git (`git status`, `git diff`, `git commit`, `gh pr create`)
- Eseguire package manager e strumenti di build (`npm install`, `npm run build`, `pytest`, `cargo build`)
- Lanciare processi a lunga esecuzione (dev server, watcher) in background con `run_in_background`
- Invocare CLI di dominio specifico (`docker`, `terraform`, `kubectl`, `gh`) che non hanno un equivalente integrato
- Concatenare passi dipendenti con `&&` quando l'ordine è importante

## Parametri

- `command` (string, obbligatorio): Il comando shell esatto da eseguire.
- `description` (string, obbligatorio): Un riassunto breve in voce attiva (5-10 parole per comandi semplici; più contesto per comandi con pipe o oscuri).
- `timeout` (number, opzionale): Timeout in millisecondi, fino a `600000` (10 minuti). Default `120000` (2 minuti).
- `run_in_background` (boolean, opzionale): Quando `true`, il comando viene eseguito in modo staccato e ricevi una notifica al completamento. Non aggiungere `&` manualmente.

## Esempi

### Esempio 1: Ispezionare lo stato del repo prima di committare
Emetti `git status` e `git diff --stat` come due chiamate `Bash` parallele nello stesso messaggio per raccogliere rapidamente il contesto, poi assembla il commit in una chiamata successiva.

### Esempio 2: Concatenare passi di build dipendenti
Usa una singola chiamata come `npm ci && npm run build && npm test` così che ogni passo venga eseguito solo dopo il successo del precedente. Usa `;` solo se vuoi intenzionalmente che i passi successivi vengano eseguiti anche dopo i fallimenti.

### Esempio 3: Dev server a lunga esecuzione
Invoca `npm run dev` con `run_in_background: true`. Riceverai una notifica quando termina. Non fare polling con loop di `sleep`; diagnostica i fallimenti invece di riprovare alla cieca.

## Note

- La working directory persiste tra le chiamate, ma lo stato della shell (variabili esportate, funzioni shell, alias) no. Preferisci percorsi assoluti ed evita `cd` a meno che l'utente non lo richieda.
- Preferisci tool dedicati agli equivalenti con pipe shell: `Glob` invece di `find`/`ls`, `Grep` invece di `grep`/`rg`, `Read` invece di `cat`/`head`/`tail`, `Edit` invece di `sed`/`awk`, `Write` invece di `echo >` o heredoc, e testo semplice dell'assistente invece di `echo`/`printf` per output destinati all'utente.
- Cita ogni percorso contenente spazi con doppi apici (ad esempio `"/Users/me/My Project/file.txt"`).
- Per comandi indipendenti, effettua più chiamate al tool `Bash` in parallelo all'interno di un unico messaggio. Concatena con `&&` solo quando un comando dipende da un altro.
- L'output oltre 30000 caratteri viene troncato. Quando catturi log di grandi dimensioni, reindirizza a un file e poi leggilo con il tool `Read`.
- Non usare mai flag interattive come `git rebase -i` o `git add -i`; non possono ricevere input tramite questo tool.
- Non saltare gli hook git (`--no-verify`, `--no-gpg-sign`) né eseguire operazioni distruttive (`reset --hard`, `push --force`, `clean -f`) a meno che l'utente non le richieda esplicitamente.
