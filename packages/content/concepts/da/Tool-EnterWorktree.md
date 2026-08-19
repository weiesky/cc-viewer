# EnterWorktree

Opretter et isoleret Git-worktree på en ny branch, eller skifter sessionen til et eksisterende worktree i det aktuelle repository, så parallelt eller eksperimentelt arbejde kan fortsætte uden at røre det primære checkout.

## Hvornår skal den bruges

- Brugeren siger udtrykkeligt "worktree" — for eksempel "start et worktree", "opret et worktree" eller "arbejd i et worktree".
- Projektinstruktioner i `CLAUDE.md` eller vedvarende hukommelse anviser dig at bruge et worktree til den aktuelle opgave.
- Du vil fortsætte en opgave, der tidligere blev sat op som et worktree (send `path` for at gå ind i det igen).
- Flere eksperimentelle branches skal sameksistere på disken uden konstant checkout-churn.
- En langvarig opgave bør isoleres fra urelaterede redigeringer i hovedarbejdstræet.

## Parametre

- `name` (string, valgfri): Et navn til en ny worktree-mappe. Hvert `/`-separeret segment må kun indeholde bogstaver, cifre, prikker, understregninger og bindestreger; hele strengen er begrænset til 64 tegn. Hvis udeladt, og `path` også er udeladt, genereres et tilfældigt navn. Gensidigt udelukkende med `path`.
- `path` (string, valgfri): Filsystemstien til et eksisterende worktree af det aktuelle repository, der skal skiftes til. Skal fremgå af `git worktree list` for dette repo; stier, der ikke er registrerede worktrees af det aktuelle repo, afvises. Gensidigt udelukkende med `name`.

## Eksempler

### Eksempel 1: Opret et nyt worktree med et beskrivende navn

```
EnterWorktree(name="feat/okta-sso")
```

Opretter `.claude/worktrees/feat/okta-sso` på en ny branch baseret på `HEAD` og skifter derefter sessionens arbejdsmappe ind i det. Alle efterfølgende filredigeringer og shell-kommandoer opererer inde i det worktree, indtil du afslutter.

### Eksempel 2: Gå ind i et eksisterende worktree igen

```
EnterWorktree(path="/Users/me/repo/.claude/worktrees/feat/okta-sso")
```

Genoptager arbejde i et tidligere oprettet worktree. Fordi du gik ind via `path`, vil `ExitWorktree` ikke slette det automatisk — forlader du det med `action: "keep"`, returneres du blot til den oprindelige mappe.

## Noter

- Kald ikke `EnterWorktree`, medmindre brugeren udtrykkeligt har bedt om det, eller projektinstruktioner kræver det. Almindelige branch-skift eller fejlrettelsesanmodninger bør bruge normale Git-kommandoer, ikke worktrees.
- Når værktøjet kaldes inde i et Git-repository, opretter det et worktree under `.claude/worktrees/` og registrerer en ny branch baseret på `HEAD`. Uden for et Git-repository delegerer det til konfigurerede `WorktreeCreate` / `WorktreeRemove`-hooks i `settings.json` for VCS-agnostisk isolation.
- Kun én worktree-session er aktiv ad gangen. Værktøjet nægter at køre, hvis du allerede er inde i en worktree-session; afslut først med `ExitWorktree`.
- Brug `ExitWorktree` til at forlade midt i en session. Hvis sessionen slutter, mens du stadig er inde i et nyoprettet worktree, bliver brugeren bedt om at beholde eller fjerne det.
- Worktrees, der er tilgået via `path`, betragtes som eksterne — `ExitWorktree` med `action: "remove"` vil ikke slette dem. Dette er et sikkerhedsrækværk for at beskytte worktrees, brugeren håndterer manuelt.
- Et nyt worktree arver den aktuelle branchs indhold, men har en uafhængig arbejdsmappe og indeks. Staged og unstaged ændringer i hovedcheckout'et er ikke synlige inde i worktree'et.
- Navngivningstip: præfiks med typen af arbejde (`feat/`, `fix/`, `spike/`), så flere samtidige worktrees er nemme at skelne i `git worktree list`.
