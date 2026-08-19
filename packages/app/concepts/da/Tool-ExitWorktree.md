# ExitWorktree

Afslutter en worktree-session, der tidligere er oprettet af `EnterWorktree`, og returnerer sessionen til den oprindelige arbejdsmappe. Dette værktøj virker udelukkende på worktrees, der er oprettet af `EnterWorktree` i den aktuelle session; er ingen sådan session aktiv, er kaldet uden effekt.

## Hvornår skal den bruges

- Arbejdet i en isoleret worktree er afsluttet, og du ønsker at vende tilbage til den primære arbejdsmappe.
- En opgave i en feature-branch-worktree er fuldført og er merget, og du ønsker at rydde op i branchen og mappen.
- Du ønsker at bevare worktreeet til senere brug og blot vende tilbage til den oprindelige mappe uden at slette noget.
- Du ønsker at opgive en eksperimentel eller midlertidig branch uden at efterlade artefakter på disken.
- Du skal starte en ny `EnterWorktree`-session, hvilket kræver, at du først afslutter den nuværende.

## Parametre

- `action` (streng, påkrævet): `"keep"` bevarer worktree-mappen og branchen på disken, så du kan vende tilbage senere; `"remove"` sletter både mappen og branchen for en ren afslutning.
- `discard_changes` (boolesk, valgfri, standard `false`): Kun relevant, når `action` er `"remove"`. Indeholder worktreeet ucommittede filer eller commits, der ikke findes i den oprindelige branch, nægter værktøjet at fjerne det, medmindre `discard_changes` er sat til `true`. Fejlsvaret viser de berørte ændringer, så du kan bekræfte med brugeren, inden du kalder igen.

## Eksempler

### Eksempel 1: ren afslutning efter merging af ændringer

Efter at have afsluttet arbejdet i en worktree og merget branchen ind i main, kald `ExitWorktree` med `action: "remove"` for at slette worktree-mappen og branchen og vende tilbage til den oprindelige arbejdsmappe.

```
ExitWorktree(action: "remove")
```

### Eksempel 2: kassér en midlertidig worktree med ucommittet eksperimentel kode

Indeholder en worktree eksperimentelle, ucommittede ændringer, der skal kasseres fuldstændigt, forsøg først `action: "remove"`. Værktøjet nægter og viser de ucommittede ændringer. Efter bekræftelse fra brugeren om, at ændringerne kan kasseres, kald igen med `discard_changes: true`.

```
ExitWorktree(action: "remove", discard_changes: true)
```

## Noter

- Dette værktøj virker udelukkende på worktrees oprettet af `EnterWorktree` i den aktuelle session. Det berører ikke worktrees oprettet med `git worktree add`, worktrees fra tidligere sessioner eller den almindelige arbejdsmappe, hvis `EnterWorktree` aldrig er blevet kaldt — i disse tilfælde er kaldet uden effekt.
- `action: "remove"` afvises, hvis worktreeet har ucommittede ændringer eller commits, der ikke er til stede i den oprindelige branch, medmindre `discard_changes: true` angives eksplicit. Bekræft altid med brugeren, inden du sætter `discard_changes: true`, da data ikke kan gendannes.
- Er en tmux-session tilknyttet worktreeet: ved `remove` afbrydes den; ved `keep` fortsætter den, og dens navn returneres, så brugeren kan tilslutte sig igen senere.
- Når `ExitWorktree` er afsluttet, kan `EnterWorktree` kaldes igen for at starte en ny worktree-session.
