# EnterWorktree

Oppretter et isolert Git-worktree på en ny branch, eller bytter sesjonen inn i et eksisterende worktree av gjeldende repository, slik at parallelt eller eksperimentelt arbeid kan pågå uten å berøre hovedutsjekken.

## Når skal den brukes

- Brukeren sier eksplisitt "worktree" — for eksempel "start et worktree", "opprett et worktree" eller "jobb i et worktree".
- Prosjektinstruksjoner i `CLAUDE.md` eller vedvarende minne peker på at du skal bruke et worktree for gjeldende oppgave.
- Du vil fortsette en oppgave som tidligere ble satt opp som et worktree (send `path` for å gå inn igjen).
- Flere eksperimentelle branches må sameksistere på disk uten stadig utsjekkskifte.
- En langvarig oppgave bør isoleres fra urelaterte endringer i hovedarbeidstreet.

## Parametere

- `name` (string, valgfri): Navn på en ny worktree-katalog. Hvert `/`-separerte segment kan kun inneholde bokstaver, tall, punktum, understreker og bindestreker; hele strengen er begrenset til 64 tegn. Hvis utelatt og `path` også er utelatt, genereres et tilfeldig navn. Gjensidig utelukkende med `path`.
- `path` (string, valgfri): Filsystemsti til et eksisterende worktree av gjeldende repository som sesjonen skal bytte til. Må vises i `git worktree list` for dette repoet; stier som ikke er registrerte worktrees av gjeldende repo avvises. Gjensidig utelukkende med `name`.

## Eksempler

### Eksempel 1: Opprett et nytt worktree med beskrivende navn

```
EnterWorktree(name="feat/okta-sso")
```

Oppretter `.claude/worktrees/feat/okta-sso` på en ny branch basert på `HEAD`, og bytter deretter sesjonens arbeidskatalog inn i det. Alle påfølgende filredigeringer og shell-kommandoer opererer inne i worktreet til du avslutter.

### Eksempel 2: Gå tilbake inn i et eksisterende worktree

```
EnterWorktree(path="/Users/me/repo/.claude/worktrees/feat/okta-sso")
```

Gjenopptar arbeidet i et tidligere opprettet worktree. Fordi du gikk inn via `path`, vil `ExitWorktree` ikke slette det automatisk — å forlate med `action: "keep"` returnerer ganske enkelt til den opprinnelige katalogen.

## Notater

- Ikke kall `EnterWorktree` med mindre brukeren eksplisitt har bedt om det eller prosjektinstruksjoner krever det. Vanlig branch-bytte eller feilrettingsforespørsler bør bruke normale Git-kommandoer, ikke worktrees.
- Når den kalles inne i et Git-repository, oppretter verktøyet et worktree under `.claude/worktrees/` og registrerer en ny branch basert på `HEAD`. Utenfor et Git-repository delegerer det til konfigurerte `WorktreeCreate` / `WorktreeRemove` hooks i `settings.json` for VCS-agnostisk isolasjon.
- Kun én worktree-sesjon er aktiv om gangen. Verktøyet nekter å kjøre hvis du allerede er inne i en worktree-sesjon; avslutt først med `ExitWorktree`.
- Bruk `ExitWorktree` for å forlate midt i sesjonen. Hvis sesjonen avsluttes mens du fortsatt er inne i et nyopprettet worktree, blir brukeren spurt om å beholde eller fjerne det.
- Worktrees man går inn i via `path` regnes som eksterne — `ExitWorktree` med `action: "remove"` vil ikke slette dem. Dette er et sikkerhetsrekkverk for å beskytte worktrees brukeren administrerer manuelt.
- Et nytt worktree arver innholdet til gjeldende branch, men har en uavhengig arbeidskatalog og indeks. Stagede og ustagede endringer i hovedutsjekken er ikke synlige inne i worktreet.
- Navnetips: prefiks med type arbeid (`feat/`, `fix/`, `spike/`) slik at flere samtidige worktrees er enkle å skille i `git worktree list`.
