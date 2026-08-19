# Agent

Starter en autonom Claude Code-underagent med sit eget kontekstvindue til at håndtere en fokuseret opgave og returnere et enkelt konsolideret resultat. Dette er den kanoniske mekanisme til at delegere åben research, parallelt arbejde eller teamsamarbejde.

## Hvornår skal den bruges

- Åbne søgninger, hvor du endnu ikke ved, hvilke filer der er relevante, og forventer flere runder af `Glob`, `Grep` og `Read`.
- Parallelt uafhængigt arbejde — start flere agenter i én besked for samtidigt at undersøge adskilte områder.
- Isolering af støjende udforskning fra hovedsamtalen, så forældrekonteksten forbliver kompakt.
- Delegering til en specialiseret underagenttype som `Explore`, `Plan`, `claude-code-guide` eller `statusline-setup`.
- Indkaldelse af en navngivet holdkammerat til et aktivt team med henblik på koordineret multi-agent-arbejde.

Brug IKKE værktøjet, når målet (fil eller symbol) allerede er kendt — brug `Read`, `Grep` eller `Glob` direkte. Et opslag i et trin gennem `Agent` spilder et helt kontekstvindue og tilføjer latenstid.

## Parametre

- `description` (string, påkrævet): Kort 3-5 ords etiket, der beskriver opgaven; vises i UI og logs.
- `prompt` (string, påkrævet): Den fuldstændige, selvstændige briefing, agenten skal udføre. Skal indeholde al nødvendig kontekst, begrænsninger og det forventede returformat.
- `subagent_type` (string, valgfri): Forudindstillet persona som `general-purpose`, `Explore`, `Plan`, `claude-code-guide` eller `statusline-setup`. Standard er `general-purpose`.
- `run_in_background` (boolean, valgfri): Hvis true, kører agenten asynkront, og forælderen kan fortsætte arbejdet; resultaterne hentes senere.
- `model` (string, valgfri): Tilsidesæt modellen for denne agent — `opus`, `sonnet` eller `haiku`. Standard er forældrens sessionmodel.
- `isolation` (string, valgfri): Sæt til `worktree` for at køre agenten i et isoleret git-worktree, så dens filsystemskriverier ikke kolliderer med forælderen.
- `team_name` (string, valgfri): Ved indkaldelse til et eksisterende team er dette team-identifikatoren, agenten slutter sig til.
- `name` (string, valgfri): Adresserbart holdkammeratsnavn inden for teamet, brugt som `to`-mål for `SendMessage`.

## Eksempler

### Eksempel 1: Åben kodesøgning

```
Agent(
  description="Find auth middleware",
  subagent_type="Explore",
  prompt="Locate every place in this repo where JWT verification is performed. Return a bulleted list of absolute file paths with a one-line note about each site's role. Do not modify any files."
)
```

### Eksempel 2: Parallelle uafhængige undersøgelser

Start to agenter i samme besked — én der inspicerer build-pipelinen, én der gennemgår testrammen. Hver får sit eget kontekstvindue og returnerer en opsummering. Batchning i en enkelt værktøjskaldsblok kører dem samtidigt.

### Eksempel 3: Indkald en holdkammerat til et kørende team

```
Agent(
  description="Data layer specialist",
  team_name="refactor-crew",
  name="db-lead",
  prompt="You are db-lead on team refactor-crew. Audit all Prisma schema files and propose a migration plan. Use SendMessage to report findings to the team leader."
)
```

## Noter

- Agenter har ingen hukommelse af tidligere kørsler. Hver invokering starter fra nul, så `prompt` skal være fuldstændig selvstændig — medtag filstier, konventioner, spørgsmålet og den eksakte form på det svar, du vil have tilbage.
- Agenten returnerer præcis én sidste besked. Den kan ikke stille afklarende spørgsmål midt i kørslen, så tvetydighed i prompten bliver til gætværk i resultatet.
- At køre flere agenter parallelt er markant hurtigere end sekventielle kald, når deludgaverne er uafhængige. Batch dem i en enkelt værktøjskaldsblok.
- Brug `isolation: "worktree"` når en agent skriver filer, og du vil gennemgå ændringerne, før de flettes ind i det primære arbejdstræ.
- Foretræk `subagent_type: "Explore"` til skrivebeskyttet rekognoscering og `Plan` til designarbejde; `general-purpose` er standarden for blandede læse-/skriveopgaver.
- Baggrundsagenter (`run_in_background: true`) egner sig til langtkørende jobs; undgå polling i en sleep-løkke — forælderen får besked ved afslutning.
