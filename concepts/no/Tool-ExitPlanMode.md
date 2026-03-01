# ExitPlanMode

## Definisjon

Går ut av planleggingsmodus og sender planen til brukeren for godkjenning. Planinnholdet leses fra planfilen som ble skrevet tidligere.

## Parametere

| Parameter | Type | Påkrevd | Beskrivelse |
|-----------|------|---------|-------------|
| `allowedPrompts` | array | Nei | Liste over tillatelsesbeskrivelser som kreves for implementeringsplanen |

Hvert element i `allowedPrompts`-arrayen:

| Felt | Type | Påkrevd | Beskrivelse |
|------|------|---------|-------------|
| `tool` | enum | Ja | Gjeldende verktøy, for øyeblikket støttes kun `Bash` |
| `prompt` | string | Ja | Semantisk beskrivelse av operasjonen (f.eks. "run tests", "install dependencies") |

## Bruksscenarioer

**Egnet for bruk:**
- Planen er ferdig i planleggingsmodus og klar til å sendes for brukergodkjenning
- Brukes kun for implementeringsoppgaver som krever kodeskriving

**Ikke egnet for bruk:**
- Rene forsknings-/utforskningsoppgaver — trenger ikke å gå ut av planleggingsmodus
- Spørre "er planen OK?" — dette er nettopp funksjonen til dette verktøyet, ikke bruk AskUserQuestion for det

## Merknader

- Dette verktøyet aksepterer ikke planinnhold som parameter — det leser fra planfilen som ble skrevet tidligere
- Brukeren vil se innholdet i planfilen for godkjenning
- Ikke bruk AskUserQuestion før du kaller dette verktøyet for å spørre "er planen OK", det er overflødig
- Ikke nevn "planen" i spørsmål, fordi brukeren ikke ser planinnholdet før ExitPlanMode

## Betydning i cc-viewer

ExitPlanMode-kall markerer slutten på planleggingsfasen. I forespørselsloggen går forespørslene etter dette kallet vanligvis over til implementeringsoperasjoner (Edit, Write, Bash osv.).

## Originaltekst

<textarea readonly>Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval.

## How This Tool Works
- You should have already written your plan to the plan file specified in the plan mode system message
- This tool does NOT take the plan content as a parameter - it will read the plan from the file you wrote
- This tool simply signals that you're done planning and ready for the user to review and approve
- The user will see the contents of your plan file when they review it

## When to Use This Tool
IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.

## Before Using This Tool
Ensure your plan is complete and unambiguous:
- If you have unresolved questions about requirements or approach, use AskUserQuestion first (in earlier phases)
- Once your plan is finalized, use THIS tool to request approval

**Important:** Do NOT use AskUserQuestion to ask "Is this plan okay?" or "Should I proceed?" - that's exactly what THIS tool does. ExitPlanMode inherently requests user approval of your plan.

## Examples

1. Initial task: "Search for and understand the implementation of vim mode in the codebase" - Do not use the exit plan mode tool because you are not planning the implementation steps of a task.
2. Initial task: "Help me implement yank mode for vim" - Use the exit plan mode tool after you have finished planning the implementation steps of the task.
3. Initial task: "Add a new feature to handle user authentication" - If unsure about auth method (OAuth, JWT, etc.), use AskUserQuestion first, then use exit plan mode tool after clarifying the approach.
</textarea>
