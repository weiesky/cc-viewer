# SubAgent: Search

## Formål

Search-underagenten er en lettvekts, skrivebeskyttet utforskningsagent. Dispatch den når du trenger å forstå en kodebase — finne hvor noe bor, lære hvordan komponenter passer sammen, eller besvare strukturelle spørsmål — uten å endre noen filer. Den er optimalisert for mange små lesinger på tvers av mange filer, og returnerer et konsist sammendrag i stedet for rå søkeutdata.

Search er ikke en generell assistent. Den kan ikke redigere kode, kjøre bygg, committe endringer eller åpne nettverkstilkoblinger utover skrivebeskyttede henting. Verdien er at den kan brenne gjennom et stort utforskningsbudsjett parallelt uten å bruke hovedagentens kontekst, og deretter levere tilbake et kompakt svar.

## Når skal den brukes

- Du trenger å besvare et spørsmål som krever tre eller flere distinkte søk eller lesinger. Eksempel: "How is authentication wired from the login route down to the session store?"
- Målet er ukjent — du vet ennå ikke hvilken fil, modul eller symbol du skal se på.
- Du trenger en strukturell oversikt over et ukjent område av repoet før du gjør endringer.
- Du vil krysshenvise flere kandidater (for eksempel hvilken av flere lignende navngitte helpers faktisk kalles i produksjon).
- Du trenger et litteratur-stils sammendrag: "list every place that imports X and categorise by call site."

Ikke bruk Search når:

- Du kjenner allerede den eksakte filen og linjen. Kall `Read` direkte.
- En enkelt `Grep` eller `Glob` vil besvare spørsmålet. Kjør det direkte; å dispatche en underagent legger til overhead.
- Oppgaven krever redigering, kjøring av kommandoer eller annen sideeffekt. Search er skrivebeskyttet som design.
- Du trenger eksakt ordrett utdata av et verktøykall. Underagenter oppsummerer; de proxy-er ikke rå resultater.

## Grundighetsnivåer

Velg nivået som matcher innsatsen til spørsmålet.

- `quick` — noen få målrettede søk, beste innsats-svar. Bruk når du trenger en rask peker (for eksempel, "hvor er env-var-parsingslogikken?") og er komfortabel med å iterere hvis svaret er ufullstendig.
- `medium` — standardvalget. Flere runder med søk, krysssjekking av kandidater, og å lese de mest relevante filene i sin helhet. Bruk for typiske "hjelp meg forstå dette området"-spørsmål.
- `very thorough` — uttømmende utforskning. Underagenten vil jage hvert plausibelt spor, lese omkringliggende kontekst, og dobbeltsjekke funn før oppsummering. Bruk når korrekthet betyr noe (for eksempel sikkerhetsgjennomgang, migrasjonsplanlegging) eller når et ufullstendig svar vil forårsake omarbeid.

Høyere grundighet koster mer tid og tokens inne i underagenten, men de tokens holdes inne i underagenten — kun det endelige sammendraget returnerer til hovedagenten.

## Tilgjengelige verktøy

Search har tilgang til alle skrivebeskyttede verktøy hovedagenten bruker, og ingenting annet:

- `Read` — for å lese spesifikke filer, inkludert delvise områder.
- `Grep` — for innholdssøk på tvers av treet.
- `Glob` — for å lokalisere filer etter navnemønster.
- `Bash` i skrivebeskyttet modus — for kommandoer som inspiserer tilstand uten å mutere den (for eksempel `git log`, `git show`, `ls`, `wc`).
- `WebFetch` og `WebSearch` — for å lese ekstern dokumentasjon når den konteksten er påkrevd.

Redigeringsverktøy (`Write`, `Edit`, `NotebookEdit`), shell-kommandoer som modifiserer tilstand, og oppgavegrafsverktøy (`TaskCreate`, `TaskUpdate` og så videre) er bevisst utilgjengelige.

## Notater

- Gi Search-underagenten et spesifikt spørsmål, ikke et emne. "List every caller of `renderMessage` and note which ones pass a custom theme" returnerer et nyttig svar; "tell me about rendering" gjør det ikke.
- Underagenten returnerer et sammendrag. Hvis du trenger eksakte filbaner, be om dem eksplisitt i prompten.
- Flere uavhengige spørsmål er best dispatchet som parallelle Search-underagenter i stedet for én lang prompt, slik at hver kan fokusere.
- Fordi Search ikke kan redigere, par den med et oppfølgende redigeringstrinn i hovedagenten når du vet hva du skal endre.
- Behandle Search-utdata som bevis, ikke grunnsannhet. For noe som bærer vekt, åpne de siterte filene selv før du handler.
