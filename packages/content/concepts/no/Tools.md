# Oversikt over Claude Code-verktøy

Claude Code tilbyr en samling innebygde verktøy til modellen via tool_use-mekanismen i Anthropic API. `tools`-arrayen i hver MainAgent-forespørsel inneholder komplette JSON Schema-definisjoner for disse verktøyene, og modellen kaller dem i responsen via `tool_use` content blocks.

Nedenfor er en kategorisert indeks over alle verktøy.

## Agent-system

| Verktøy | Formål |
|---------|--------|
| [Agent](Tool-Agent.md) | Starte en sub-agent (SubAgent) for å håndtere komplekse flerstegsoppgaver |
| [TaskOutput](Tool-TaskOutput.md) | Hente utdata fra bakgrunnsoppgaver |
| [TaskStop](Tool-TaskStop.md) | Stoppe en kjørende bakgrunnsoppgave |
| [TaskCreate](Tool-TaskCreate.md) | Opprette et strukturert oppgavelisteelement |
| [TaskGet](Tool-TaskGet.md) | Hente oppgavedetaljer |
| [TaskUpdate](Tool-TaskUpdate.md) | Oppdatere oppgavestatus, avhengigheter osv. |
| [TaskList](Tool-TaskList.md) | Liste alle oppgaver |
| [ListAgents](Tool-ListAgents.md) | Liste agentene som er tilgjengelige i sesjonen |

## Team og orkestrering

| Verktøy | Formål |
|---------|--------|
| [SendMessage](Tool-SendMessage.md) | Sende en melding til en annen agent |
| [Workflow](Tool-Workflow.md) | Kjør en deterministisk multi-agent orkestreringsscript |
| [Monitor](Tool-Monitor.md) | Streame hendelser fra et langvarig script som varsler |
| [SendFile](Tool-SendFile.md) | Sende filer til en annen Claude Code-sesjon |
| [SendUserFile](Tool-SendUserFile.md) | Sende filer til brukeren |
| [SendUserMessage](Tool-SendUserMessage.md) | Sende en melding til brukeren (legacy Brief-verktøy) |
| [EndConversation](Tool-EndConversation.md) | Avslutte gjeldende samtale |

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
| [ToolSearch](Tool-ToolSearch.md) | Søke og laste inn utsatte/MCP-verktøy etter behov |

## Terminal

| Verktøy | Formål |
|---------|--------|
| [Bash](Tool-Bash.md) | Kjøre shell-kommandoer |
| [REPL](Tool-REPL.md) | Kjøre JavaScript i en persistent Node.js REPL |

## Web

| Verktøy | Formål |
|---------|--------|
| [WebFetch](Tool-WebFetch.md) | Hente nettsidens innhold og behandle det med AI |
| [WebSearch](Tool-WebSearch.md) | Søkemotorforespørsler |
| [Artifact](Tool-Artifact.md) | Publiser en HTML/Markdown-fil som en hostet claude.ai-webside |
| [DesignSync](Tool-DesignSync.md) | Synkroniser et lokalt komponentbibliotek med et claude.ai design-system prosjekt |

## Planlegging og interaksjon

| Verktøy | Formål |
|---------|--------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | Gå inn i planleggingsmodus for å designe implementeringsplan |
| [ExitPlanMode](Tool-ExitPlanMode.md) | Gå ut av planleggingsmodus og sende planen til brukergodkjenning |
| [AskUserQuestion](Tool-AskUserQuestion.md) | Stille spørsmål til brukeren for avklaring eller beslutninger |
| [ReportFindings](Tool-ReportFindings.md) | Rapporter kodegjennomgangsfunn som en typet liste til vert-brukergrensesnittet |
| [TodoWrite](Tool-TodoWrite.md) | Skrive en strukturert todo-liste for sesjonen |
| [SendFeedback](Tool-SendFeedback.md) | Sende strukturert tilbakemelding om Claude Code til Anthropic |
| [Projects](Tool-Projects.md) | Administrere prosjektkunnskapsbase-dokumenter |
| [ProposeGoal](Tool-ProposeGoal.md) | Foreslå et verifiserbart fullføringsmål for sesjonen |

## Arbeidstrær

| Verktøy | Formål |
|---------|--------|
| [EnterWorktree](Tool-EnterWorktree.md) | Opprette eller gå inn i isolert git worktree for sessionen |
| [ExitWorktree](Tool-ExitWorktree.md) | Forlate worktree-sessionen, behold eller fjern den |

## Planlegging og varsler

| Verktøy | Formål |
|---------|--------|
| [CronCreate](Tool-CronCreate.md) | Planlegg en prompt på et cron-uttrykk (gjentatt eller engangs) |
| [CronDelete](Tool-CronDelete.md) | Avbryt planlagte cron-jobb |
| [CronList](Tool-CronList.md) | List planlagte cron-jobb |
| [ScheduleWakeup](Tool-ScheduleWakeup.md) | Selvpace /loop iterasjoner ved å planlegge neste oppvåkning |
| [PushNotification](Tool-PushNotification.md) | Send skrivebord/mobil varsling til brukeren |
| [RemoteTrigger](Tool-RemoteTrigger.md) | Administrer claude.ai remote-trigger rutiner |
| [ReadNotifications](Tool-ReadNotifications.md) | Lese ventende sesjonsvarsler |

## Utvidelser

| Verktøy | Formål |
|---------|--------|
| [Skill](Tool-Skill.md) | Kjøre ferdigheter (slash command) |

## MCP og utvidelser

| Verktøy | Formål |
|---------|--------|
| [ListMcpResources](Tool-ListMcpResources.md) | Liste ressurser eksponert av tilkoblede MCP-servere |
| [ReadMcpResource](Tool-ReadMcpResource.md) | Lese én enkelt MCP-serverressurs ved URI |
| [ReadMcpResourceDir](Tool-ReadMcpResourceDir.md) | Liste en katalog-aktig MCP-ressurs ved URI |
| [SearchMcpRegistry](Tool-SearchMcpRegistry.md) | Søke i MCP connector-registeret etter nøkkelord |
| [SuggestConnectors](Tool-SuggestConnectors.md) | Løse opp connector-detaljer fra registersøkeresultater |
| [ListConnectors](Tool-ListConnectors.md) | Liste installerte MCP-connectorer |
| [SuggestPluginInstall](Tool-SuggestPluginInstall.md) | Gjengi et innebygd plugin-installasjonskort |
| [SuggestSkills](Tool-SuggestSkills.md) | Gjengi et kort med skills som kan legges til |
| [ListPlugins](Tool-ListPlugins.md) | Liste aktiverte claude.ai-plugins |
| [ListSkills](Tool-ListSkills.md) | Liste aktiverte claude.ai-skills |

## IDE-integrasjon

| Verktøy | Formål |
|---------|--------|
| [LSP](Tool-LSP.md) | Språkserver-spørringer (definisjoner, referanser, symboler) |
