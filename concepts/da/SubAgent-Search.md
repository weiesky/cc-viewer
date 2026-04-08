# SubAgent: Search

## Definition

Search er en sub-agent-type der startes af Claude Codes hovedagent for at udføre kodesøgninger. Den udfører målrettede fil- og indholdssøgninger ved hjælp af værktøjer som Glob, Grep og Read, og returnerer derefter resultaterne til forælderagenten.

## Adfærd

- Startes automatisk når hovedagenten skal søge i eller udforske kodebasen
- Kører i en isoleret kontekst med skrivebeskyttet adgang
- Bruger Glob til filmønster-matchning, Grep til indholdssøgning og Read til filinspection
- Returnerer søgeresultater til forælderagenten til videre behandling

## Hvornår det vises

Search sub-agenter vises typisk når:

1. Hovedagenten skal finde specifikke filer, funktioner eller kodemønstre
2. Brugeren anmoder om en bred udforskning af kodebasen
3. Agenten undersøger afhængigheder, referencer eller anvendelsesmønstre
