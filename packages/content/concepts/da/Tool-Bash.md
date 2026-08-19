# Bash

Kører en shell-kommando inde i en vedvarende arbejdsmappe og returnerer dens stdout/stderr. Reserveres bedst til operationer, som intet dedikeret Claude Code-værktøj kan udtrykke, såsom at køre git, npm, docker eller build-scripts.

## Hvornår skal den bruges

- Udfør git-operationer (`git status`, `git diff`, `git commit`, `gh pr create`)
- Kør pakkehåndterere og build-værktøjer (`npm install`, `npm run build`, `pytest`, `cargo build`)
- Start langvarige processer (dev-servere, watchers) i baggrunden med `run_in_background`
- Kald domænespecifikke CLI'er (`docker`, `terraform`, `kubectl`, `gh`), som ikke har en indbygget ækvivalent
- Kæd afhængige trin sammen med `&&`, når rækkefølgen er vigtig

## Parametre

- `command` (string, påkrævet): Den nøjagtige shell-kommando, der skal udføres.
- `description` (string, påkrævet): En kort, aktiv opsummering (5-10 ord for simple kommandoer; mere kontekst for piped eller obskure).
- `timeout` (number, valgfri): Timeout i millisekunder, op til `600000` (10 minutter). Standard er `120000` (2 minutter).
- `run_in_background` (boolean, valgfri): Når `true`, kører kommandoen frakoblet, og du modtager en notifikation ved afslutning. Tilføj ikke selv `&`.

## Eksempler

### Eksempel 1: Inspicér repo-status før commit
Udsted `git status` og `git diff --stat` som to parallelle `Bash`-kald i samme besked for hurtigt at indsamle kontekst, og saml derefter commit'en i et opfølgende kald.

### Eksempel 2: Kæd afhængige build-trin
Brug et enkelt kald som `npm ci && npm run build && npm test`, så hvert trin kun kører, efter det forrige lykkedes. Brug kun `;`, hvis du bevidst vil have senere trin til at køre selv efter fejl.

### Eksempel 3: Langvarig dev-server
Kald `npm run dev` med `run_in_background: true`. Du får besked, når den afslutter. Poll ikke med `sleep`-løkker; diagnosticér fejl i stedet for at prøve igen blindt.

## Noter

- Arbejdsmappen vedvarer mellem kald, men shell-tilstand (eksporterede variabler, shell-funktioner, aliasser) gør ikke. Foretræk absolutte stier, og undgå `cd`, medmindre brugeren beder om det.
- Foretræk dedikerede værktøjer frem for piped shell-ækvivalenter: `Glob` i stedet for `find`/`ls`, `Grep` i stedet for `grep`/`rg`, `Read` i stedet for `cat`/`head`/`tail`, `Edit` i stedet for `sed`/`awk`, `Write` i stedet for `echo >` eller heredocs, og almindelig assistenttekst i stedet for `echo`/`printf` til brugervendt output.
- Sæt enhver sti, der indeholder mellemrum, i dobbelte anførselstegn (for eksempel `"/Users/me/My Project/file.txt"`).
- For uafhængige kommandoer skal du lave flere `Bash`-værktøjskald parallelt i en enkelt besked. Kæd kun med `&&`, når én kommando afhænger af en anden.
- Output over 30000 tegn bliver afkortet. Når du fanger store logs, omdirigér til en fil og læs den derefter med `Read`-værktøjet.
- Brug aldrig interaktive flag som `git rebase -i` eller `git add -i`; de kan ikke modtage input gennem dette værktøj.
- Spring ikke git-hooks over (`--no-verify`, `--no-gpg-sign`), og udfør ikke destruktive operationer (`reset --hard`, `push --force`, `clean -f`), medmindre brugeren udtrykkeligt beder om det.
