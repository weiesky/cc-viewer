# Skill

## Definisjon

Kjører en ferdighet (skill) i hovedsamtalen. Ferdigheter er spesialiserte evner som brukeren kan kalle via slash-kommandoer (f.eks. `/commit`, `/review-pr`).

## Parametere

| Parameter | Type | Påkrevd | Beskrivelse |
|-----------|------|---------|-------------|
| `skill` | string | Ja | Ferdighetsnavn (f.eks. "commit", "review-pr", "pdf") |
| `args` | string | Nei | Ferdighetsparametere |

## Bruksscenarioer

**Egnet for bruk:**
- Brukeren har skrevet en slash-kommando i formatet `/<skill-name>`
- Brukerens forespørsel matcher funksjonaliteten til en registrert ferdighet

**Ikke egnet for bruk:**
- Innebygde CLI-kommandoer (f.eks. `/help`, `/clear`)
- En ferdighet som allerede kjører
- Et ferdighetsnavn som ikke finnes i listen over tilgjengelige ferdigheter

## Merknader

- Etter at ferdigheten er kalt, utvides den til et fullstendig prompt
- Støtter fullt kvalifiserte navn (f.eks. `ms-office-suite:pdf`)
- Listen over tilgjengelige ferdigheter gis i system-reminder-meldinger
- Når du ser en `<command-name>`-tag betyr det at ferdigheten allerede er lastet, og du bør kjøre den direkte i stedet for å kalle dette verktøyet igjen
- Ikke nevn en ferdighet uten å faktisk kalle verktøyet

## Betydning i cc-viewer

Skill-kall vises i forespørselsloggen som `tool_use` content block. Det utvidede ferdighets-promptet påvirker system prompt eller meldingsinnhold i påfølgende forespørsler.

## Originaltekst

<textarea readonly>Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - `skill: "pdf"` - invoke the pdf skill
  - `skill: "commit", args: "-m 'Fix bug'"` - invoke with arguments
  - `skill: "review-pr", args: "123"` - invoke with arguments
  - `skill: "ms-office-suite:pdf"` - invoke using fully qualified name

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
- If you see a <command-name> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again
</textarea>
