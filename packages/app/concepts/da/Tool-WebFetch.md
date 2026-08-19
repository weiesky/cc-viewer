# WebFetch

Henter indholdet af en offentlig webside, konverterer HTML'en til Markdown og kører en lille hjælpemodel over resultatet ved hjælp af en naturligsprogs-prompt for at udtrække den information, du har brug for.

## Hvornår skal den bruges

- Læse en offentlig dokumentationsside, blogindlæg eller RFC refereret i samtalen.
- Udtrække et specifikt faktum, kodestump eller tabel fra en kendt URL uden at indlæse hele siden i konteksten.
- Opsummere release notes eller changelogs fra en åben webressource.
- Tjekke et biblioteks offentlige API-reference, når kilden ikke er i det lokale repository.
- Følge et link, brugeren indsatte i chatten, for at svare på et opfølgningsspørgsmål.

## Parametre

- `url` (string, påkrævet): En fuldt formet absolut URL. Almindelig `http://` opgraderes automatisk til `https://`.
- `prompt` (string, påkrævet): Instruktionen, der sendes til den lille udtrækningsmodel. Beskriv præcis, hvad der skal hentes fra siden, såsom "list alle eksporterede funktioner" eller "returnér den mindste understøttede Node-version".

## Eksempler

### Eksempel 1: Udtræk en konfigurationsstandard

```
WebFetch(
  url="https://vitejs.dev/config/server-options.html",
  prompt="What is the default value of server.port and can it be a string?"
)
```

Værktøjet henter Vite-docs-siden, konverterer den til Markdown og returnerer et kort svar som "Default is `5173`; accepts a number only."

### Eksempel 2: Opsummér en changelog-sektion

```
WebFetch(
  url="https://nodejs.org/en/blog/release/v20.11.0",
  prompt="List the security fixes included in this release as bullet points."
)
```

Nyttigt, når brugeren spørger "hvad ændrede sig i Node 20.11", og release-siden er lang.

## Noter

- `WebFetch` fejler på enhver URL, der kræver autentificering, cookies eller en VPN. For Google Docs, Confluence, Jira, private GitHub-ressourcer eller interne wikier skal du i stedet bruge en dedikeret MCP-server, der giver autentificeret adgang.
- For alt, der er hostet på GitHub (PR'er, issues, fil-blobs, API-svar), foretræk `gh`-CLI gennem `Bash` frem for at scrape web-UI'et. `gh pr view`, `gh issue view` og `gh api` returnerer strukturerede data og fungerer mod private repositories.
- Resultater kan opsummeres, når den hentede side er meget stor. Hvis du har brug for præcis tekst, indsnævr `prompt` til at bede om et literalt uddrag.
- En selvrensende cache på 15 minutter anvendes pr. URL. Gentagne kald til samme side i én session er næsten øjeblikkelige, men kan returnere lettere forældet indhold. Hvis friskhed betyder noget, nævn det i prompten eller vent cachen ud.
- Hvis målhosten udsteder en cross-host-redirect, returnerer værktøjet den nye URL i en speciel svarblok og følger den ikke automatisk. Kald `WebFetch` igen med redirect-målet, hvis du stadig vil have indholdet.
- Prompten eksekveres af en mindre, hurtigere model end hovedassistenten. Hold den smal og konkret; kompleks multi-trins-ræsonnement håndteres bedre ved at læse den rå Markdown selv efter hentning.
- Send aldrig hemmeligheder, tokens eller session-identifikatorer indlejret i URL'en — sideindhold og query-strings reflekteret i output kan blive logget af upstream-tjenester.
