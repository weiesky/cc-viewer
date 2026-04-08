# Oversigt over Claude Code-værktøjer

Claude Code giver modellen et sæt indbyggede værktøjer via Anthropic API'ens tool_use-mekanisme. `tools`-arrayet i hver MainAgent-request indeholder de komplette JSON Schema-definitioner for disse værktøjer, og modellen kalder dem via `tool_use` content blocks i svaret.

Nedenfor er det kategoriserede indeks over alle værktøjer.

## Agent-system

| Værktøj | Formål |
|------|------|
| [Task](Tool-Task.md) | Start en sub-agent (SubAgent) til at håndtere komplekse flertrinsopgaver |
| [TaskOutput](Tool-TaskOutput.md) | Hent output fra en baggrundsopgave |
| [TaskStop](Tool-TaskStop.md) | Stop en kørende baggrundsopgave |
| [TaskCreate](Tool-TaskCreate.md) | Opret en struktureret opgavelistepost |
| [TaskGet](Tool-TaskGet.md) | Hent opgavedetaljer |
| [TaskUpdate](Tool-TaskUpdate.md) | Opdater opgavestatus, afhængigheder osv. |
| [TaskList](Tool-TaskList.md) | List alle opgaver |

## Filoperationer

| Værktøj | Formål |
|------|------|
| [Read](Tool-Read.md) | Læs filindhold (understøtter tekst, billeder, PDF, Jupyter notebook) |
| [Edit](Tool-Edit.md) | Rediger fil via præcis strengerstatning |
| [Write](Tool-Write.md) | Skriv eller overskriv en fil |
| [NotebookEdit](Tool-NotebookEdit.md) | Rediger Jupyter notebook-celler |

## Søgning

| Værktøj | Formål |
|------|------|
| [Glob](Tool-Glob.md) | Søg filer efter filnavnsmønster |
| [Grep](Tool-Grep.md) | Søg i filindhold baseret på ripgrep |

## Terminal

| Værktøj | Formål |
|------|------|
| [Bash](Tool-Bash.md) | Udfør shell-kommandoer |

## Web

| Værktøj | Formål |
|------|------|
| [WebFetch](Tool-WebFetch.md) | Hent webindhold og behandl det med AI |
| [WebSearch](Tool-WebSearch.md) | Søgemaskineforespørgsel |

## Planlægning og interaktion

| Værktøj | Formål |
|------|------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | Gå ind i planlægningstilstand for at designe en implementeringsplan |
| [ExitPlanMode](Tool-ExitPlanMode.md) | Forlad planlægningstilstand og indsend planen til brugerens godkendelse |
| [AskUserQuestion](Tool-AskUserQuestion.md) | Stil spørgsmål til brugeren for at få afklaring eller beslutninger |

## Udvidelser

| Værktøj | Formål |
|------|------|
| [Skill](Tool-Skill.md) | Udfør en skill (slash command) |

## IDE-integration

| Værktøj | Formål |
|------|------|
| [getDiagnostics](Tool-getDiagnostics.md) | Hent sprogdiagnostik fra VS Code |
| [executeCode](Tool-executeCode.md) | Udfør kode i Jupyter-kernen |
