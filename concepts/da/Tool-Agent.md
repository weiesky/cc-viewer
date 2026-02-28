# Agent

## Definition

Starter en sub-agent (SubAgent) til selvstændigt at håndtere komplekse flertrinsopgaver. Sub-agenter er uafhængige underprocesser, hver med deres eget dedikerede værktøjssæt og kontekst. Agent er den omdøbte version af Task-værktøjet i nyere Claude Code-versioner.

## Parametre

| Parameter | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `prompt` | string | Ja | Beskrivelse af opgaven sub-agenten skal udføre |
| `description` | string | Ja | Kort resumé på 3-5 ord |
| `subagent_type` | string | Ja | Sub-agent-type, bestemmer det tilgængelige værktøjssæt |
| `model` | enum | Nej | Angiv model (sonnet / opus / haiku), standard arvet fra forælder |
| `max_turns` | integer | Nej | Maksimalt antal agentiske ture |
| `run_in_background` | boolean | Nej | Om den skal køre i baggrunden; baggrundsopgaver returnerer output_file-sti |
| `resume` | string | Nej | Agent-ID der skal genoptages, fortsætter fra sidste udførelse. Nyttigt til at genoptage en tidligere sub-agent uden at miste kontekst |
| `isolation` | enum | Nej | Isoleringstilstand, `worktree` opretter et midlertidigt git worktree |

## Sub-agent-typer

| Type | Formål | Tilgængelige værktøjer |
|------|------|----------|
| `Bash` | Kommandoudførelse, git-operationer | Bash |
| `general-purpose` | Generelle flertrinsopgaver | Alle værktøjer |
| `Explore` | Hurtig udforskning af kodebasen | Alle værktøjer undtagen Agent/Edit/Write/NotebookEdit/ExitPlanMode |
| `Plan` | Design af implementeringsplan | Alle værktøjer undtagen Agent/Edit/Write/NotebookEdit/ExitPlanMode |
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
- Man kan starte flere parallelle Agent-kald i en enkelt besked for at øge effektiviteten
- Baggrundsopgaver overvåges via TaskOutput-værktøjet
- Explore-typen er langsommere end direkte Glob/Grep-kald, brug den kun når simpel søgning ikke er tilstrækkelig
- Brug `run_in_background: true` til langvarige opgaver der ikke kræver øjeblikkeligt resultat; brug forgrundstilstand (standard) når resultatet er nødvendigt før man fortsætter
- `resume`-parameteren gør det muligt at fortsætte en tidligere startet sub-agent-session og bevare den akkumulerede kontekst

## Betydning i cc-viewer

Agent er det nye navn for Task-værktøjet i nyere Claude Code-versioner. Agent-kald genererer SubAgent-requestkæder, der i requestlisten kan ses som uafhængige underrequestsekvenser adskilt fra MainAgent. SubAgent-requests har typisk et forenklet system prompt og færre værktøjsdefinitioner, i tydelig kontrast til MainAgent. I cc-viewer kan værktøjsnavnene `Task` eller `Agent` forekomme afhængigt af den Claude Code-version der blev brugt i den optagede samtale.
