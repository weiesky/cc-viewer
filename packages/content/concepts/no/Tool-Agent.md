# Agent

Starter en autonom Claude Code-underagent med sitt eget kontekstvindu for å håndtere en fokusert oppgave og returnere ett samlet resultat. Dette er den kanoniske mekanismen for å delegere åpen research, parallelt arbeid eller teamsamarbeid.

## Når skal den brukes

- Åpne søk der du ennå ikke vet hvilke filer som er relevante og forventer flere runder med `Glob`, `Grep` og `Read`.
- Parallelt uavhengig arbeid — start flere agenter i én melding for å undersøke separate områder samtidig.
- Isolere støyende utforskning fra hovedsamtalen slik at foreldrekonteksten holdes kompakt.
- Delegere til en spesialisert underagent-type som `Explore`, `Plan`, `claude-code-guide` eller `statusline-setup`.
- Spawne en navngitt lagkamerat inn i et aktivt team for koordinert flereagent-arbeid.

IKKE bruk når målfilen eller symbolet allerede er kjent — bruk `Read`, `Grep` eller `Glob` direkte. Et enkelt oppslag via `Agent` bruker opp et helt kontekstvindu og gir ekstra latens.

## Parametere

- `description` (string, påkrevd): Kort 3–5-ords etikett som beskriver oppgaven; vises i UI og logger.
- `prompt` (string, påkrevd): Den komplette, selvstendige briefen agenten skal utføre. Må inneholde all nødvendig kontekst, begrensninger og forventet returformat.
- `subagent_type` (string, valgfri): Forhåndsdefinert persona som `general-purpose`, `Explore`, `Plan`, `claude-code-guide` eller `statusline-setup`. Standard er `general-purpose`.
- `run_in_background` (boolean, valgfri): Hvis true kjører agenten asynkront og foreldresesjonen kan fortsette arbeidet; resultater hentes senere.
- `model` (string, valgfri): Overstyr modellen for denne agenten — `opus`, `sonnet` eller `haiku`. Standard er foreldresesjonens modell.
- `isolation` (string, valgfri): Sett til `worktree` for å kjøre agenten i et isolert git worktree slik at dens filskrivinger ikke kolliderer med foreldreprosessen.
- `team_name` (string, valgfri): Ved spawning inn i et eksisterende team, team-identifikatoren agenten blir med i.
- `name` (string, valgfri): Adresserbart lagkameratnavn innenfor teamet, brukt som `to`-mål for `SendMessage`.

## Eksempler

### Eksempel 1: Åpent kodesøk

```
Agent(
  description="Find auth middleware",
  subagent_type="Explore",
  prompt="Locate every place in this repo where JWT verification is performed. Return a bulleted list of absolute file paths with a one-line note about each site's role. Do not modify any files."
)
```

### Eksempel 2: Parallelle uavhengige undersøkelser

Start to agenter i samme melding — en som inspiserer byggepipelinen, en som går gjennom testrammen. Hver får sitt eget kontekstvindu og returnerer et sammendrag. Batching i én tool-call-blokk kjører dem samtidig.

### Eksempel 3: Spawne en lagkamerat inn i et kjørende team

```
Agent(
  description="Data layer specialist",
  team_name="refactor-crew",
  name="db-lead",
  prompt="You are db-lead on team refactor-crew. Audit all Prisma schema files and propose a migration plan. Use SendMessage to report findings to the team leader."
)
```

## Notater

- Agenter har ingen hukommelse om tidligere kjøringer. Hver invokasjon starter fra bunnen, så `prompt` må være fullstendig selvstendig — inkluder filbaner, konvensjoner, spørsmålet og den nøyaktige formen på svaret du ønsker tilbake.
- Agenten returnerer nøyaktig én siste melding. Den kan ikke stille oppklarende spørsmål midt i kjøringen, så tvetydighet i prompten blir gjetning i resultatet.
- Å kjøre flere agenter parallelt er betydelig raskere enn sekvensielle kall når deloppgavene er uavhengige. Batch dem i én tool-call-blokk.
- Bruk `isolation: "worktree"` når en agent skal skrive filer og du ønsker å gjennomgå endringer før de slås sammen med hovedarbeidstreet.
- Foretrekk `subagent_type: "Explore"` for lesebasert rekognosering og `Plan` for designarbeid; `general-purpose` er standard for blandede les/skriv-oppgaver.
- Bakgrunnsagenter (`run_in_background: true`) passer for langvarige jobber; unngå polling i sleep-loop — foreldresesjonen varsles ved fullføring.
