# Teammate

## Definition

Teammate er en samarbejdende agent i Claude Code Agent Team-tilstand. Når hoved-agenten opretter et team via `TeamCreate` og genererer teammates ved hjælp af `Agent`-værktøjet, kører hver teammate som en uafhængig agent-proces med sit eget kontekstvindue og værktøjssæt og kommunikerer med teammedlemmer via `SendMessage`.

## Forskelle fra SubAgent

| Egenskab | Teammate | SubAgent |
|----------|----------|----------|
| Livscyklus | Vedvarende, kan modtage flere beskeder | Engangsopgave, destrueres efter fuldførelse |
| Kommunikation | SendMessage tovejsbeskeder | Forælder→barn envejskald, returnerer resultat |
| Kontekst | Uafhængig fuld kontekst, bevares på tværs af ture | Isoleret opgavekontekst |
| Samarbejdsmodel | Teamsamarbejde, kan kommunikere indbyrdes | Hierarkisk struktur, interagerer kun med forælder-agent |
| Opgavetype | Komplekse flertrinsopgaver | Enkeltopgaver som søgning og udforskning |

## Adfærd

- Oprettes af hoved-agenten (team lead) via `Agent`-værktøjet og tildeles et `team_name`
- Deler opgaveliste via `TaskList` / `TaskGet` / `TaskUpdate`
- Går i idle-tilstand efter hver udførelsesrunde og venter på at blive vækket af nye beskeder
- Kan afsluttes elegant via `shutdown_request`

## Forklaring af statistikpanelet

Teammate-statistikpanelet viser antallet af API-kald for hver teammate. Kolonnen `Name` er teammate-navnet (f.eks. `reviewer-security`, `reviewer-pipeline`), og kolonnen `Antal` er det samlede antal API-anmodninger genereret af den pågældende teammate.
