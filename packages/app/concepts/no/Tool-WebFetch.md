# WebFetch

Henter innholdet på en offentlig nettside, konverterer HTML til Markdown, og kjører en liten hjelpemodell over resultatet med en naturligspråklig prompt for å hente ut informasjonen du trenger.

## Når skal den brukes

- Lese en offentlig dokumentasjonsside, blogginnlegg eller RFC referert til i samtalen.
- Hente ut et spesifikt faktum, kodesnutt eller tabell fra en kjent URL uten å laste hele siden inn i konteksten.
- Oppsummere release notes eller changelogs fra en åpen webressurs.
- Sjekke et biblioteks offentlige API-referanse når kilden ikke er i det lokale repositoriet.
- Følge en lenke brukeren limte inn i chatten for å svare på et oppfølgingsspørsmål.

## Parametere

- `url` (string, påkrevd): En fullstendig formet absolutt URL. Ren `http://` oppgraderes automatisk til `https://`.
- `prompt` (string, påkrevd): Instruksjonen som sendes til den lille uttrekksmodellen. Beskriv nøyaktig hva som skal hentes fra siden, som "list all exported functions" eller "return the minimum supported Node version".

## Eksempler

### Eksempel 1: Hent ut en konfigurasjonsstandard

```
WebFetch(
  url="https://vitejs.dev/config/server-options.html",
  prompt="What is the default value of server.port and can it be a string?"
)
```

Verktøyet henter Vite-dokumentasjonssiden, konverterer den til Markdown og returnerer et kort svar som "Default is `5173`; accepts a number only."

### Eksempel 2: Oppsummer en changelog-seksjon

```
WebFetch(
  url="https://nodejs.org/en/blog/release/v20.11.0",
  prompt="List the security fixes included in this release as bullet points."
)
```

Nyttig når brukeren spør "hva endret seg i Node 20.11" og release-siden er lang.

## Notater

- `WebFetch` feiler på enhver URL som krever autentisering, cookies eller VPN. For Google Docs, Confluence, Jira, private GitHub-ressurser eller interne wikier, bruk en dedikert MCP-server som gir autentisert tilgang i stedet.
- For alt som er hostet på GitHub (PR-er, issues, fil-blobs, API-svar), foretrekk `gh`-CLI gjennom `Bash` fremfor å skrape web-UI-et. `gh pr view`, `gh issue view` og `gh api` returnerer strukturerte data og fungerer mot private repositorier.
- Resultater kan oppsummeres når den hentede siden er veldig stor. Hvis du trenger eksakt tekst, snevre inn `prompt` til å be om et bokstavelig utdrag.
- En selvrensende 15-minutters cache anvendes per URL. Gjentatte kall til samme side i én sesjon er nesten umiddelbare, men kan returnere noe foreldet innhold. Hvis ferskhet betyr noe, nevn det i prompten eller vent ut cachen.
- Hvis målverten utsteder en redirect på tvers av verter, returnerer verktøyet den nye URL-en i en spesiell svarblokk og følger den ikke automatisk. Påkall `WebFetch` på nytt med redirect-målet hvis du fortsatt vil ha innholdet.
- Prompten utføres av en mindre, raskere modell enn hovedassistenten. Hold den smal og konkret; komplekst flertrinns-resonnement håndteres bedre ved å lese den rå Markdown selv etter henting.
- Send aldri inn hemmeligheter, tokens eller øktidentifikatorer innebygd i URL-en — sideinnhold og query-strenger reflektert i utdata kan bli logget av oppstrømstjenester.
