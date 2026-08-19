# Edit

Utfører en nøyaktig strengerstatning inne i en eksisterende fil. Det er den foretrukne måten å modifisere filer på fordi kun diffen overføres, noe som holder endringer presise og reviderbare.

## Når skal den brukes

- Fikse en feil i én funksjon uten å omskrive resten av filen
- Oppdatere en konfigurasjonsverdi, versjonstreng eller importsti
- Omdøpe et symbol på tvers av en fil med `replace_all`
- Sette inn en blokk nær et anker (utvid `old_string` til å inkludere nærliggende kontekst, og oppgi deretter erstatningen)
- Anvende små, godt avgrensede endringer som del av en flertrinnsrefaktorering

## Parametere

- `file_path` (string, påkrevd): Absolutt sti til filen som skal modifiseres.
- `old_string` (string, påkrevd): Den nøyaktige teksten å søke etter. Må matche tegn-for-tegn, inkludert mellomrom og innrykk.
- `new_string` (string, påkrevd): Erstatningsteksten. Må være forskjellig fra `old_string`.
- `replace_all` (boolean, valgfri): Når `true` erstattes hver forekomst av `old_string`. Standard er `false`, som krever at treffet er unikt.

## Eksempler

### Eksempel 1: Fiks ett enkelt kallsted
Sett `old_string` til den eksakte linjen `const port = 3000;` og `new_string` til `const port = process.env.PORT ?? 3000;`. Treffet er unikt, så `replace_all` kan bli stående på standard.

### Eksempel 2: Omdøp et symbol på tvers av en fil
For å omdøpe `getUser` til `fetchUser` overalt i `api.ts`, sett `old_string: "getUser"`, `new_string: "fetchUser"` og `replace_all: true`.

### Eksempel 3: Avklar et gjentatt utdrag
Hvis `return null;` finnes i flere grener, utvid `old_string` til å inkludere omkringliggende kontekst (for eksempel forutgående `if`-linje) slik at treffet blir unikt. Ellers vil verktøyet gi feil i stedet for å gjette.

## Notater

- Du må kalle `Read` på filen minst én gang i gjeldende sesjon før `Edit` vil akseptere endringer. Linjenummer-prefikser fra `Read`-utdata er ikke del av filinnholdet; ikke inkluder dem i `old_string` eller `new_string`.
- Mellomrom må matche nøyaktig. Vær oppmerksom på tab versus mellomrom og etterfølgende mellomrom, spesielt i YAML, Makefiles og Python.
- Hvis `old_string` ikke er unik og `replace_all` er `false`, feiler redigeringen. Utvid enten konteksten eller aktiver `replace_all`.
- Foretrekk `Edit` fremfor `Write` når filen allerede finnes; `Write` overskriver hele filen og mister urelatert innhold hvis du ikke er forsiktig.
- For flere urelaterte endringer i samme fil, send flere `Edit`-kall i rekkefølge i stedet for én stor, skjør erstatning.
- Unngå å introdusere emoji, markedsføringstekst eller ubestilte dokumentasjonsblokker når du redigerer kildefiler.
