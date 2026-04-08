# SubAgent: Search

## Definisjon

Search er en sub-agent-type som startes av Claude Codes hovedagent for å utføre søk i kodebasen. Den kjører målrettede fil- og innholdssøk ved hjelp av verktøy som Glob, Grep og Read, og returnerer deretter resultatene til overordnet agent.

## Atferd

- Startes automatisk når hovedagenten trenger å søke i eller utforske kodebasen
- Kjører i en isolert kontekst med lesetilgang
- Bruker Glob for filnønsamsvar, Grep for innholdssøk og Read for filinspeksjon
- Returnerer søkeresultater til overordnet agent for videre behandling

## Når det vises

Search sub-agenter vises typisk når:

1. Hovedagenten trenger å finne bestemte filer, funksjoner eller kodemønstre
2. En bred kodebaseutforskning er forespurt av brukeren
3. Agenten undersøker avhengigheter, referanser eller bruksmønstre
