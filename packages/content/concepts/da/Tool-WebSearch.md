# WebSearch

Udfører en live websøgning og returnerer rangerede resultater, som assistenten bruger til at grundlægge sit svar i aktuel information ud over modellens træningscutoff.

## Hvornår skal den bruges

- Besvare spørgsmål om aktuelle begivenheder, nylige udgivelser eller breaking news.
- Slå den nyeste version op af et bibliotek, framework eller CLI-værktøj.
- Finde dokumentation eller blogindlæg, når den nøjagtige URL er ukendt.
- Verificere et faktum, der kan have ændret sig, siden modellen blev trænet.
- Opdage flere perspektiver på et emne, før du henter en enkelt side med `WebFetch`.

## Aktivering

- Tilgængelighed afhænger af udbyder og model: tilgængelig på Anthropic API og Claude Platform on AWS; på Microsoft Foundry kræver det en Anthropic-hostet deployment; på Google Cloud virker det med Claude 4+-modeller.
- Ikke tilgængelig på Amazon Bedrock.
- Sæt loft på 200 kald pr. session med `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`.

## Parametre

- `query` (string, påkrævet): Søgeforespørgslen. Minimum længde 2 tegn. Inkludér det aktuelle år, når du spørger om "nyeste" eller "seneste" information, så resultaterne er friske.
- `allowed_domains` (array af strings, valgfri): Begrænser resultater til kun disse domæner, for eksempel `["nodejs.org", "developer.mozilla.org"]`. Nyttigt, når du stoler på en specifik kilde.
- `blocked_domains` (array af strings, valgfri): Udelukker resultater fra disse domæner. Send ikke det samme domæne til både `allowed_domains` og `blocked_domains`.

## Eksempler

### Eksempel 1: Versionsopslag med aktuelt år

```
WebSearch(
  query="React 19 stable release date 2026",
  allowed_domains=["react.dev", "github.com"]
)
```

Returnerer officielle meddelelser og undgår lavkvalitets-aggregatorsider.

### Eksempel 2: Udeluk støjende kilder

```
WebSearch(
  query="kubernetes ingress-nginx CVE April 2026",
  blocked_domains=["pinterest.com", "medium.com"]
)
```

Holder resultaterne fokuseret på leverandør-advisories og sikkerhedstrackere.

## Noter

- Når du bruger `WebSearch` i et svar, skal du tilføje en `Sources:`-sektion i slutningen af dit svar, der lister hvert citeret resultat som en Markdown-hyperlink i form `[Title](URL)`. Dette er et hårdt krav, ikke valgfrit.
- `WebSearch` er kun tilgængelig for brugere i USA. Hvis værktøjet ikke er tilgængeligt i din region, fald tilbage til `WebFetch` mod en kendt URL, eller bed brugeren om at indsætte relevant indhold.
- Hvert kald udfører søgningen i en enkelt tur-retur — du kan ikke streame eller paginere. Finjustér forespørgslen, hvis det første resultatsæt rammer ved siden af.
- Værktøjet returnerer uddrag og metadata, ikke fuldt sideindhold. For at læse et specifikt hit i dybden, følg op med `WebFetch` ved hjælp af den returnerede URL.
- Brug `allowed_domains` til at håndhæve autoritativ kildeangivelse for sikkerhedsfølsomme spørgsmål som CVE'er eller compliance, og `blocked_domains` til at skære SEO-farme, der spejler dokumentation, væk.
- Hold forespørgsler korte og nøgleordsdrevne. Naturligsprogs-spørgsmål virker, men har tendens til at returnere samtaleagtige svar frem for primære kilder.
- Opfind ikke URL'er baseret på søgeintuition — kør altid søgningen og citer, hvad værktøjet faktisk returnerede.
