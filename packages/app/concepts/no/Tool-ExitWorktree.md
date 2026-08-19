# ExitWorktree

Avslutter en worktree-økt som tidligere ble opprettet av `EnterWorktree`, og returnerer økten til den opprinnelige arbeidsmappen. Dette verktøyet virker utelukkende på worktrees som er opprettet av `EnterWorktree` i gjeldende økt; er ingen slik økt aktiv, har kallet ingen effekt.

## Når skal den brukes

- Arbeidet i en isolert worktree er fullført og du ønsker å returnere til den primære arbeidsmappen.
- En oppgave i en feature-branch-worktree er ferdig og etter sammenslåing ønsker du å rydde opp i grenen og mappen.
- Du ønsker å beholde worktree til senere bruk og ganske enkelt returnere til den opprinnelige mappen uten å slette noe.
- Du ønsker å forkaste en eksperimentell eller midlertidig gren uten å etterlate artefakter på disken.
- Du må starte en ny `EnterWorktree`-økt, noe som krever at du først avslutter den gjeldende.

## Parametere

- `action` (streng, obligatorisk): `"keep"` beholder worktree-mappen og grenen på disken slik at du kan returnere til dem senere; `"remove"` sletter både mappen og grenen for en ren avslutning.
- `discard_changes` (boolsk, valgfri, standard `false`): Kun relevant når `action` er `"remove"`. Inneholder worktree ucommittede filer eller commits som ikke finnes i den opprinnelige grenen, nekter verktøyet fjerning med mindre `discard_changes` er satt til `true`. Feilsvaret lister opp de aktuelle endringene slik at du kan bekrefte med brukeren før du kaller på nytt.

## Eksempler

### Eksempel 1: ren avslutning etter sammenslåing av endringer

Etter å ha fullført arbeidet i en worktree og slått sammen grenen i main, kall `ExitWorktree` med `action: "remove"` for å slette worktree-mappen og grenen og returnere til den opprinnelige arbeidsmappen.

```
ExitWorktree(action: "remove")
```

### Eksempel 2: forkast en midlertidig worktree med ucommittet eksperimentell kode

Inneholder en worktree eksperimentelle, ucommittede endringer som skal forkastes fullstendig, forsøk først `action: "remove"`. Verktøyet nekter og lister opp de ucommittede endringene. Etter bekreftelse fra brukeren om at endringene kan forkastes, kall på nytt med `discard_changes: true`.

```
ExitWorktree(action: "remove", discard_changes: true)
```

## Notater

- Dette verktøyet virker utelukkende på worktrees opprettet av `EnterWorktree` i gjeldende økt. Det vil ikke påvirke worktrees opprettet med `git worktree add`, worktrees fra tidligere økter eller den vanlige arbeidsmappen dersom `EnterWorktree` aldri ble kalt — i disse tilfellene har kallet ingen effekt.
- `action: "remove"` avvises hvis worktree har ucommittede endringer eller commits som ikke finnes i den opprinnelige grenen, med mindre `discard_changes: true` oppgis eksplisitt. Bekreft alltid med brukeren før du setter `discard_changes: true`, ettersom data ikke kan gjenopprettes.
- Er en tmux-økt tilknyttet worktree: ved `remove` avsluttes den; ved `keep` fortsetter den å kjøre, og navnet returneres slik at brukeren kan koble seg til igjen senere.
- Etter at `ExitWorktree` er fullført, kan `EnterWorktree` kalles igjen for å starte en ny worktree-økt.
