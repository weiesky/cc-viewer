# Task

> **Merk:** I nyere versjoner av Claude Code har dette verktøyet blitt omdøpt til **Agent**. Se dokumentet [Tool-Agent](Tool-Agent).

## Definisjon

Starter en sub-agent (SubAgent) for å selvstendig håndtere komplekse flerstegsoppgaver. Sub-agenter er uavhengige underprosesser, hver med sitt eget dedikerte verktøysett og kontekst.

## Parametere

| Parameter | Type | Påkrevd | Beskrivelse |
|-----------|------|---------|-------------|
| `prompt` | string | Ja | Beskrivelse av oppgaven sub-agenten skal utføre |
| `description` | string | Ja | Kort sammendrag på 3–5 ord |
| `subagent_type` | string | Ja | Sub-agent-type, bestemmer tilgjengelig verktøysett |
| `model` | enum | Nei | Spesifiser modell (sonnet / opus / haiku), standard arves fra overordnet |
| `max_turns` | integer | Nei | Maksimalt antall agentiske runder |
| `run_in_background` | boolean | Nei | Om den skal kjøres i bakgrunnen, bakgrunnsoppgaver returnerer output_file-sti |
| `resume` | string | Nei | Agent-ID som skal gjenopptas, fortsetter fra siste kjøring |
| `isolation` | enum | Nei | Isolasjonsmodus, `worktree` oppretter midlertidig git worktree |

## Sub-agent-typer

| Type | Formål | Tilgjengelige verktøy |
|------|--------|----------------------|
| `Bash` | Kommandokjøring, git-operasjoner | Bash |
| `general-purpose` | Generelle flerstegsoppgaver | Alle verktøy |
| `Explore` | Rask kodebaseutforskning | Alle verktøy unntatt Task/Edit/Write/NotebookEdit/ExitPlanMode |
| `Plan` | Designe implementeringsplaner | Alle verktøy unntatt Task/Edit/Write/NotebookEdit/ExitPlanMode |
| `claude-code-guide` | Spørsmål og svar om Claude Code-bruk | Glob, Grep, Read, WebFetch, WebSearch |
| `statusline-setup` | Konfigurere statuslinje | Read, Edit |

## Bruksscenarioer

**Egnet for bruk:**
- Komplekse oppgaver som krever selvstendig flerstegsgjennomføring
- Kodebaseutforskning og dybdeforskning (bruk Explore-type)
- Parallelt arbeid som krever isolert miljø
- Langvarige oppgaver som må kjøres i bakgrunnen

**Ikke egnet for bruk:**
- Lese en spesifikk filsti — bruk Read eller Glob direkte
- Søke i 2–3 kjente filer — bruk Read direkte
- Søke etter en spesifikk klassedefinisjon — bruk Glob direkte

## Merknader

- Etter at sub-agenten er ferdig, returnerer den en enkelt melding; resultatene er ikke synlige for brukeren og må videreformidles av hovedagenten
- Kan starte flere parallelle Task-kall i en enkelt melding for økt effektivitet
- Bakgrunnsoppgaver sjekkes via TaskOutput-verktøyet
- Explore-typen er tregere enn direkte Glob/Grep-kall, bruk kun når enkelt søk ikke er tilstrekkelig
