# Teammate

## Definisjon

Teammate er en samarbeidende agent i Claude Code Agent Team-modus. Når hovedagenten oppretter et team via `TeamCreate` og genererer teammates ved hjelp av `Agent`-verktøyet, kjører hver teammate som en uavhengig agentprosess med sitt eget kontekstvindu og verktøysett, og kommuniserer med teammedlemmer via `SendMessage`.

## Forskjeller fra SubAgent

| Egenskap | Teammate | SubAgent |
|----------|----------|----------|
| Livssyklus | Vedvarende, kan motta flere meldinger | Engangsoppgave, destrueres etter fullførelse |
| Kommunikasjon | SendMessage toveismeldinger | Forelder→barn enveiskall, returnerer resultat |
| Kontekst | Uavhengig fullstendig kontekst, bevares på tvers av runder | Isolert oppgavekontekst |
| Samarbeidsmodell | Teamsamarbeid, kan kommunisere innbyrdes | Hierarkisk struktur, interagerer kun med foreldreagent |
| Oppgavetype | Komplekse flertrinnsoppgaver | Enkeltoppgaver som søk og utforskning |

## Atferd

- Opprettes av hovedagenten (team lead) via `Agent`-verktøyet og tildeles et `team_name`
- Deler oppgaveliste via `TaskList` / `TaskGet` / `TaskUpdate`
- Går i idle-tilstand etter hver utførelsesrunde og venter på å bli vekket av nye meldinger
- Kan avsluttes elegant via `shutdown_request`

## Forklaring av statistikkpanelet

Teammate-statistikkpanelet viser antall API-kall for hver teammate. Kolonnen `Name` er teammate-navnet (f.eks. `reviewer-security`, `reviewer-pipeline`), og kolonnen `Antall` er det totale antallet API-forespørsler generert av den aktuelle teammatien.
