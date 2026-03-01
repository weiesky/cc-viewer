# Skill

## Definition

Udfører en skill i hovedsamtalen. Skills er specialiserede evner, som brugeren kan kalde via slash commands (f.eks. `/commit`, `/review-pr`).

## Parametre

| Parameter | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `skill` | string | Ja | Skill-navn (f.eks. "commit", "review-pr", "pdf") |
| `args` | string | Nej | Skill-argumenter |

## Brugsscenarier

**Egnet til:**
- Brugeren har indtastet en slash command i formatet `/<skill-name>`
- Brugerens anmodning matcher funktionaliteten af en registreret skill

**Ikke egnet til:**
- Indbyggede CLI-kommandoer (f.eks. `/help`, `/clear`)
- En skill der allerede kører
- Skill-navne der ikke er i listen over tilgængelige skills

## Bemærkninger

- Efter kald udvides skillen til et komplet prompt
- Understøtter fuldt kvalificerede navne (f.eks. `ms-office-suite:pdf`)
- Listen over tilgængelige skills leveres i system-reminder-beskeder
- Når du ser et `<command-name>`-tag, betyder det, at skillen er indlæst og skal udføres direkte uden at kalde dette værktøj igen
- Nævn ikke en skill uden faktisk at have kaldt værktøjet

## Betydning i cc-viewer

Skill-kald vises i requestloggen som `tool_use` content block. Det udvidede prompt fra skillen påvirker system prompten eller beskedindholdet i efterfølgende requests.

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
