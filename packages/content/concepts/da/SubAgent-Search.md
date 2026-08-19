# SubAgent: Search

## Formål

Search-underagenten er en letvægts, skrivebeskyttet udforskningsagent. Udsend den, når du har brug for at forstå en kodebase — finde hvor noget bor, lære hvordan komponenter passer sammen, eller besvare strukturelle spørgsmål — uden at ændre nogen filer. Den er optimeret til mange små læsninger på tværs af mange filer og returnerer en kortfattet opsummering frem for rå søgeoutput.

Search er ikke en generel assistent. Den kan ikke redigere kode, køre builds, committe ændringer eller åbne netværksforbindelser ud over skrivebeskyttede hentninger. Dens værdi er, at den kan brænde gennem et stort udforskningsbudget parallelt uden at forbruge hovedagentens kontekst og derefter give et kompakt svar tilbage.

## Hvornår skal den bruges

- Du har brug for at besvare et spørgsmål, der kræver tre eller flere distinkte søgninger eller læsninger. Eksempel: "Hvordan er autentificering kablet fra login-ruten ned til session-storen?"
- Målet er ukendt — du ved endnu ikke, hvilken fil, modul eller symbol der skal kigges på.
- Du har brug for et strukturelt overblik over et ukendt område af repoet, før du foretager ændringer.
- Du vil krydsreferere flere kandidater (for eksempel hvilken af flere lignende navngivne hjælpefunktioner, der faktisk kaldes i produktion).
- Du har brug for en litteratur-stil-opsummering: "list hvert sted, der importerer X, og kategorisér efter kaldsstedet."

Brug ikke Search, når:

- Du allerede kender den nøjagtige fil og linje. Kald `Read` direkte.
- En enkelt `Grep` eller `Glob` vil besvare spørgsmålet. Kør den direkte; at udsende en underagent tilføjer overhead.
- Opgaven kræver redigering, kørsel af kommandoer eller enhver sideeffekt. Search er skrivebeskyttet pr. design.
- Du har brug for nøjagtigt ordret output af et værktøjskald. Underagenter opsummerer; de proxer ikke rå resultater.

## Grundighedsniveauer

Vælg det niveau, der matcher spørgsmålets indsats.

- `quick` — nogle få målrettede søgninger, bedst mulig besvarelse. Brug, når du har brug for en hurtig pegepind (for eksempel "hvor er env-var-parsing-logikken?") og er komfortabel med at iterere, hvis svaret er ufuldstændigt.
- `medium` — standarden. Flere runder af søgning, krydskontrol af kandidater og læsning af de mest relevante filer fuldt ud. Brug til typiske "hjælp mig med at forstå dette område"-spørgsmål.
- `very thorough` — udtømmende udforskning. Underagenten vil jage hvert plausibelt spor, læse omgivende kontekst og dobbeltkontrollere fund, før den opsummerer. Brug, når korrekthed betyder noget (for eksempel sikkerhedsgennemgang, migrationsplanlægning), eller når et ufuldstændigt svar vil forårsage omarbejde.

Højere grundighed koster mere tid og tokens inde i underagenten, men disse tokens forbliver inde i underagenten — kun den endelige opsummering returnerer til hovedagenten.

## Tilgængelige værktøjer

Search har adgang til alle skrivebeskyttede værktøjer, hovedagenten bruger, og intet andet:

- `Read` — til at læse specifikke filer, inklusive delvise intervaller.
- `Grep` — til indholds-søgninger på tværs af træet.
- `Glob` — til at lokalisere filer efter navnemønster.
- `Bash` i skrivebeskyttet tilstand — til kommandoer, der inspicerer tilstand uden at mutere den (for eksempel `git log`, `git show`, `ls`, `wc`).
- `WebFetch` og `WebSearch` — til at læse ekstern dokumentation, når den kontekst er påkrævet.

Redigeringsværktøjer (`Write`, `Edit`, `NotebookEdit`), shell-kommandoer der ændrer tilstand, og task-graph-værktøjer (`TaskCreate`, `TaskUpdate` osv.) er bevidst utilgængelige.

## Noter

- Giv Search-underagenten et specifikt spørgsmål, ikke et emne. "List hver opkalder af `renderMessage`, og notér hvilke der sender et custom tema" returnerer et nyttigt svar; "fortæl mig om rendering" gør ikke.
- Underagenten returnerer en opsummering. Hvis du har brug for nøjagtige filstier, bed eksplicit om dem i din prompt.
- Flere uafhængige spørgsmål udsendes bedst som parallelle Search-underagenter frem for én lang prompt, så hver kan fokusere.
- Fordi Search ikke kan redigere, par den med et opfølgende redigeringstrin i hovedagenten, når du ved, hvad der skal ændres.
- Behandl Search-output som evidens, ikke som grundsandhed. For alt bærende, åbn de citerede filer selv, før du handler.
