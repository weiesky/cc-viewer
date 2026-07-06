# Task

> **Bemærk:** I nyere versioner af Claude Code er dette værktøj omdøbt til **Agent**. Se dokumentet [Tool-Agent](Tool-Agent).

## Definition

Starter en sub-agent (SubAgent) til selvstændigt at håndtere komplekse flertrinsopgaver. Sub-agenter er uafhængige underprocesser, hver med deres eget dedikerede værktøjssæt og kontekst.

## Parametre

| Parameter | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `prompt` | string | Ja | Beskrivelse af opgaven sub-agenten skal udføre |
| `description` | string | Ja | Kort resumé på 3-5 ord |
| `subagent_type` | string | Ja | Sub-agent-type, bestemmer det tilgængelige værktøjssæt |
| `model` | enum | Nej | Angiv model (sonnet / opus / haiku), standard arvet fra forælder |
| `max_turns` | integer | Nej | Maksimalt antal agentiske ture |
| `run_in_background` | boolean | Nej | Om den skal køre i baggrunden; baggrundsopgaver returnerer output_file-sti |
| `resume` | string | Nej | Agent-ID der skal genoptages, fortsætter fra sidste udførelse |
| `isolation` | enum | Nej | Isoleringstilstand, `worktree` opretter et midlertidigt git worktree |

## Sub-agent-typer

| Type | Formål | Tilgængelige værktøjer |
|------|------|----------|
| `Bash` | Kommandoudførelse, git-operationer | Bash |
| `general-purpose` | Generelle flertrinsopgaver | Alle værktøjer |
| `Explore` | Hurtig udforskning af kodebasen | Alle værktøjer undtagen Task/Edit/Write/NotebookEdit/ExitPlanMode |
| `Plan` | Design af implementeringsplan | Alle værktøjer undtagen Task/Edit/Write/NotebookEdit/ExitPlanMode |
| `claude-code-guide` | Q&A om Claude Code-brugsvejledning | Glob, Grep, Read, WebFetch, WebSearch |
| `statusline-setup` | Konfiguration af statuslinje | Read, Edit |

## Brugsscenarier

**Egnet til:**
- Komplekse opgaver der kræver selvstændig fuldførelse i flere trin
- Udforskning af kodebasen og dybdegående research (brug Explore-type)
- Parallelt arbejde der kræver isolerede miljøer
- Langvarige opgaver der skal køre i baggrunden

**Ikke egnet til:**
- Læse en specifik filsti — brug direkte Read eller Glob
- Søge i 2-3 kendte filer — brug direkte Read
- Søge efter en specifik klassedefinition — brug direkte Glob

## Bemærkninger

- Ved fuldførelse returnerer sub-agenten en enkelt besked; dens resultat er ikke synligt for brugeren og skal videreformidles af hovedagenten
- Man kan starte flere parallelle Task-kald i en enkelt besked for at øge effektiviteten
- Baggrundsopgaver overvåges via TaskOutput-værktøjet
- Explore-typen er langsommere end direkte Glob/Grep-kald, brug den kun når simpel søgning ikke er tilstrækkelig
