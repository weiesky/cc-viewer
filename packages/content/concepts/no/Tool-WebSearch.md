# WebSearch

Utfører et live websøk og returnerer rangerte resultater som assistenten bruker for å forankre svaret sitt i aktuell informasjon utover modellens treningskutoff.

## Når skal den brukes

- Besvare spørsmål om aktuelle hendelser, nylige utgivelser eller breaking news.
- Slå opp den nyeste versjonen av et bibliotek, rammeverk eller CLI-verktøy.
- Finne dokumentasjon eller blogginnlegg når den eksakte URL-en er ukjent.
- Verifisere et faktum som kan ha endret seg siden modellen ble trent.
- Oppdage flere perspektiver på et emne før du henter en enkelt side med `WebFetch`.

## Aktivering

- Tilgjengeligheten er leverandør- og modellavhengig: tilgjengelig på Anthropic API og Claude Platform on AWS; på Microsoft Foundry kreves en Anthropic-hostet deployment; på Google Cloud fungerer den med Claude 4+-modeller.
- Ikke tilgjengelig på Amazon Bedrock.
- Begrens til 200 kall per sesjon med `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`.

## Parametere

- `query` (string, påkrevd): Søkefrasen. Minimumslengde 2 tegn. Inkluder gjeldende år når du spør om "nyeste" eller "nylig" informasjon slik at resultatene er ferske.
- `allowed_domains` (array av strenger, valgfri): Begrenser resultater til kun disse domenene, for eksempel `["nodejs.org", "developer.mozilla.org"]`. Nyttig når du stoler på en bestemt kilde.
- `blocked_domains` (array av strenger, valgfri): Ekskluderer resultater fra disse domenene. Ikke send det samme domenet til både `allowed_domains` og `blocked_domains`.

## Eksempler

### Eksempel 1: Versjonsoppslag med gjeldende år

```
WebSearch(
  query="React 19 stable release date 2026",
  allowed_domains=["react.dev", "github.com"]
)
```

Returnerer offisielle kunngjøringer og unngår lav-kvalitets aggregatorsider.

### Eksempel 2: Ekskluder støyete kilder

```
WebSearch(
  query="kubernetes ingress-nginx CVE April 2026",
  blocked_domains=["pinterest.com", "medium.com"]
)
```

Holder resultater fokusert på leverandørråd og sikkerhets-trackere.

## Notater

- Når du bruker `WebSearch` i et svar, må du legge til en `Sources:`-seksjon på slutten av svaret som lister hvert sitert resultat som en Markdown-hyperlenke på formen `[Title](URL)`. Dette er et hardt krav, ikke valgfritt.
- `WebSearch` er kun tilgjengelig for brukere i USA. Hvis verktøyet er utilgjengelig i din region, fall tilbake til `WebFetch` mot en kjent URL eller be brukeren lime inn relevant innhold.
- Hvert kall utfører søket i én tur-retur — du kan ikke strømme eller paginere. Raffiner spørringen hvis det første resultatsettet er utenfor mål.
- Verktøyet returnerer snutter og metadata, ikke fullt sideinnhold. For å lese et spesifikt treff i dybden, følg opp med `WebFetch` ved å bruke den returnerte URL-en.
- Bruk `allowed_domains` for å håndheve autoritative kilder for sikkerhetssensitive spørsmål som CVE-er eller compliance, og `blocked_domains` for å kutte ut SEO-farms som speiler dokumentasjon.
- Hold spørringer korte og nøkkelord-drevne. Naturligspråklige spørsmål fungerer, men har en tendens til å returnere samtalesvar i stedet for primærkilder.
- Ikke finn opp URL-er basert på søkeintuisjon — kjør alltid søket og siter hva verktøyet faktisk returnerte.
