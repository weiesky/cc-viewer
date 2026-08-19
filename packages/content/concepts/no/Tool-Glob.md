# Glob

Matcher filnavn mot et glob-mønster og returnerer stiene sortert etter nyeste modifikasjonstidspunkt først. Optimalisert for raskt å lokalisere filer i kodebaser av enhver størrelse uten å shelle ut til `find`.

## Når skal den brukes

- Ramse opp hver fil med en bestemt filendelse (for eksempel alle `*.ts`-filer under `src`)
- Oppdage konfigurasjons- eller fixturfiler etter navnekonvensjon (`**/jest.config.*`, `**/*.test.tsx`)
- Snevre inn en søkeflate før du kjører en målrettet `Grep`
- Sjekke om en fil allerede finnes på et kjent mønster før du kaller `Write`
- Finne nylig berørte filer ved å stole på sortering etter modifikasjonstid

## Parametere

- `pattern` (string, påkrevd): Glob-uttrykket som skal matches. Støtter `*` for enkeltsegment-jokertegn, `**` for rekursive treff og `{a,b}` for alternativer, for eksempel `src/**/*.{ts,tsx}`.
- `path` (string, valgfri): Katalogen søket skal kjøres i. Må være en gyldig katalogsti når den oppgis. Utelat feltet helt for å søke i gjeldende arbeidskatalog. Ikke send inn strengene `"undefined"` eller `"null"`.

## Eksempler

### Eksempel 1: Hver TypeScript-kildefil
Kall `Glob` med `pattern: "src/**/*.ts"`. Resultatet er en mtime-sortert liste, så de sist redigerte filene vises først, noe som er nyttig for å fokusere på hot spots.

### Eksempel 2: Lokaliser en kandidat for klassedefinisjon
Når du mistenker at en klasse ligger i en fil med ukjent navn, søk med `pattern: "**/*UserService*"` for å snevre inn kandidatene, og følg opp med `Read` eller `Grep`.

### Eksempel 3: Parallell oppdagelse før en større oppgave
Send flere `Glob`-kall i én melding (for eksempel én for `**/*.test.ts` og én for `**/fixtures/**`) slik at begge kjører parallelt og resultatene kan korreleres.

## Notater

- Resultater er sortert etter filens modifikasjonstid (nyeste først), ikke alfabetisk. Sorter nedstrøms hvis du trenger stabil rekkefølge.
- Mønstre evalueres av verktøyet, ikke av skallet; du trenger ikke sitere eller escape dem slik du ville gjort på kommandolinjen.
- For åpen utforskning som krever flere runder med søk og resonnement, deleger til en `Agent` med Explore-agenttypen i stedet for å lenke mange `Glob`-kall.
- Foretrekk `Glob` fremfor `Bash`-invokasjoner av `find` eller `ls` for filnavnsoppdagelse; det håndterer tillatelser konsekvent og returnerer strukturert utdata.
- Når du leter etter innhold inne i filer i stedet for filnavn, bruk `Grep` i stedet.
