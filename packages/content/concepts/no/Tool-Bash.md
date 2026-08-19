# Bash

Kjører en shell-kommando i et persistent arbeidskatalog og returnerer stdout/stderr. Bør reserveres for operasjoner som ingen dedikert Claude Code-verktøy kan uttrykke, som å kjøre git, npm, docker eller byggeskript.

## Når skal den brukes

- Utføre git-operasjoner (`git status`, `git diff`, `git commit`, `gh pr create`)
- Kjøre pakkebehandlere og byggeverktøy (`npm install`, `npm run build`, `pytest`, `cargo build`)
- Starte langvarige prosesser (dev-servere, watchere) i bakgrunnen med `run_in_background`
- Kalle domenespesifikke CLI-er (`docker`, `terraform`, `kubectl`, `gh`) som ikke har noen innebygd ekvivalent
- Lenke sammen avhengige steg med `&&` når rekkefølge betyr noe

## Parametere

- `command` (string, påkrevd): Den nøyaktige shell-kommandoen som skal utføres.
- `description` (string, påkrevd): Et kort sammendrag i aktiv stemme (5–10 ord for enkle kommandoer; mer kontekst for piped eller obskure).
- `timeout` (number, valgfri): Tidsavbrudd i millisekunder, opp til `600000` (10 minutter). Standard er `120000` (2 minutter).
- `run_in_background` (boolean, valgfri): Når `true` kjører kommandoen frakoblet og du mottar et varsel ved fullføring. Ikke legg til `&` selv.

## Eksempler

### Eksempel 1: Inspiser repo-tilstand før commit
Send `git status` og `git diff --stat` som to parallelle `Bash`-kall i samme melding for raskt å samle kontekst, og sett deretter sammen commit-en i et oppfølgingskall.

### Eksempel 2: Lenk avhengige byggesteg
Bruk ett enkelt kall som `npm ci && npm run build && npm test` slik at hvert steg kun kjører etter at det forrige lyktes. Bruk `;` kun hvis du bevisst vil at senere steg skal kjøre selv etter feil.

### Eksempel 3: Langvarig dev-server
Kall `npm run dev` med `run_in_background: true`. Du får varsel når den avsluttes. Ikke poll med `sleep`-loops; diagnostiser feil i stedet for å prøve blindt på nytt.

## Notater

- Arbeidskatalogen persisterer mellom kall, men shell-tilstand (eksporterte variabler, shell-funksjoner, aliaser) gjør det ikke. Foretrekk absolutte stier og unngå `cd` med mindre brukeren ber om det.
- Foretrekk dedikerte verktøy fremfor piped shell-ekvivalenter: `Glob` i stedet for `find`/`ls`, `Grep` i stedet for `grep`/`rg`, `Read` i stedet for `cat`/`head`/`tail`, `Edit` i stedet for `sed`/`awk`, `Write` i stedet for `echo >` eller heredocs, og vanlig assistenttekst i stedet for `echo`/`printf` for brukerrettet utdata.
- Siter enhver sti som inneholder mellomrom med doble anførselstegn (for eksempel `"/Users/me/My Project/file.txt"`).
- For uavhengige kommandoer, gjør flere `Bash`-verktøykall parallelt i én melding. Lenk kun med `&&` når en kommando er avhengig av en annen.
- Utdata over 30000 tegn trunkeres. Når du fanger opp store logger, omdiriger til en fil og les den deretter med `Read`-verktøyet.
- Bruk aldri interaktive flagg som `git rebase -i` eller `git add -i`; de kan ikke motta input gjennom dette verktøyet.
- Ikke hopp over git-hooks (`--no-verify`, `--no-gpg-sign`) eller utfør destruktive operasjoner (`reset --hard`, `push --force`, `clean -f`) med mindre brukeren eksplisitt ber om det.
