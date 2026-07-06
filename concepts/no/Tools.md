# Oversikt over Claude Code-verktøy

Claude Code tilbyr en samling innebygde verktøy til modellen via tool_use-mekanismen i Anthropic API. `tools`-arrayen i hver MainAgent-forespørsel inneholder komplette JSON Schema-definisjoner for disse verktøyene, og modellen kaller dem i responsen via `tool_use` content blocks.

Nedenfor er en kategorisert indeks over alle verktøy.

## Agent-system

| Verktøy | Formål |
|---------|--------|
| [Task](Tool-Task.md) | Starte en sub-agent (SubAgent) for å håndtere komplekse flerstegsoppgaver |
| [TaskOutput](Tool-TaskOutput.md) | Hente utdata fra bakgrunnsoppgaver |
| [TaskStop](Tool-TaskStop.md) | Stoppe en kjørende bakgrunnsoppgave |
| [TaskCreate](Tool-TaskCreate.md) | Opprette et strukturert oppgavelisteelement |
| [TaskGet](Tool-TaskGet.md) | Hente oppgavedetaljer |
| [TaskUpdate](Tool-TaskUpdate.md) | Oppdatere oppgavestatus, avhengigheter osv. |
| [TaskList](Tool-TaskList.md) | Liste alle oppgaver |

## Filoperasjoner

| Verktøy | Formål |
|---------|--------|
| [Read](Tool-Read.md) | Lese filinnhold (støtter tekst, bilder, PDF, Jupyter notebook) |
| [Edit](Tool-Edit.md) | Redigere filer via nøyaktig strengerstatning |
| [Write](Tool-Write.md) | Skrive eller overskrive filer |
| [NotebookEdit](Tool-NotebookEdit.md) | Redigere Jupyter notebook-celler |

## Søk

| Verktøy | Formål |
|---------|--------|
| [Glob](Tool-Glob.md) | Søke etter filer med filnavnmønstermatching |
| [Grep](Tool-Grep.md) | Innholdssøk i filer basert på ripgrep |

## Terminal

| Verktøy | Formål |
|---------|--------|
| [Bash](Tool-Bash.md) | Kjøre shell-kommandoer |

## Web

| Verktøy | Formål |
|---------|--------|
| [WebFetch](Tool-WebFetch.md) | Hente nettsidens innhold og behandle det med AI |
| [WebSearch](Tool-WebSearch.md) | Søkemotorforespørsler |

## Planlegging og interaksjon

| Verktøy | Formål |
|---------|--------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | Gå inn i planleggingsmodus for å designe implementeringsplan |
| [ExitPlanMode](Tool-ExitPlanMode.md) | Gå ut av planleggingsmodus og sende planen til brukergodkjenning |
| [AskUserQuestion](Tool-AskUserQuestion.md) | Stille spørsmål til brukeren for avklaring eller beslutninger |

## Utvidelser

| Verktøy | Formål |
|---------|--------|
| [Skill](Tool-Skill.md) | Kjøre ferdigheter (slash command) |

## IDE-integrasjon

| Verktøy | Formål |
|---------|--------|
| [getDiagnostics](Tool-getDiagnostics.md) | Hente språkdiagnostikk fra VS Code |
| [executeCode](Tool-executeCode.md) | Kjøre kode i Jupyter kernel |
