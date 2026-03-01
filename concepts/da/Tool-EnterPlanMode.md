# EnterPlanMode

## Definition

Skifter Claude Code til planlægningstilstand, der bruges til at udforske kodebasen og designe en plan før implementering.

## Parametre

Ingen parametre.

## Brugsscenarier

**Egnet til:**
- Implementering af nye funktioner — kræver arkitekturbeslutninger
- Der findes flere mulige tilgange — kræver brugerens valg
- Kodeændringer påvirker eksisterende adfærd eller struktur
- Ændringer i flere filer — involverer potentielt 2-3 eller flere filer
- Uklare krav — nødvendigt at udforske først for at forstå omfanget
- Brugerpræferencer er vigtige — implementeringen kan have flere rimelige retninger

**Ikke egnet til:**
- Rettelser af én eller få linjer (stavefejl, åbenlyse fejl)
- Brugeren har givet meget specifikke instruktioner
- Rene forsknings-/udforskningsopgaver — brug Task (Explore-type)

## Adfærd i planlægningstilstand

Efter at være gået ind i planlægningstilstand vil Claude Code:
1. Bruge Glob-, Grep-, Read-værktøjer til at udforske kodebasen i dybden
2. Forstå eksisterende mønstre og arkitektur
3. Designe implementeringsplanen
4. Indsende planen til brugerens godkendelse
5. Bruge AskUserQuestion til afklaring om nødvendigt
6. Forlade tilstanden via ExitPlanMode, når planen er klar

## Bemærkninger

- Dette værktøj kræver brugerens samtykke for at gå ind i planlægningstilstand
- Hvis du er i tvivl om, hvorvidt planlægning er nødvendig, foretrækkes planlægning — at afstemme på forhånd er bedre end at lave om

## Betydning i cc-viewer

EnterPlanMode-kald vises i requestloggen som `tool_use` content block. Requestsekvensen efter at være gået ind i planlægningstilstand er typisk domineret af udforskende værktøjskald (Glob, Grep, Read), indtil ExitPlanMode kaldes.

## Originaltekst

<textarea readonly>Use this tool proactively when you're about to start a non-trivial implementation task. Getting user sign-off on your approach before writing code prevents wasted effort and ensures alignment. This tool transitions you into plan mode where you can explore the codebase and design an implementation approach for user approval.

## When to Use This Tool

**Prefer using EnterPlanMode** for implementation tasks unless they're simple. Use it when ANY of these conditions apply:

1. **New Feature Implementation**: Adding meaningful new functionality
   - Example: "Add a logout button" - where should it go? What should happen on click?
   - Example: "Add form validation" - what rules? What error messages?

2. **Multiple Valid Approaches**: The task can be solved in several different ways
   - Example: "Add caching to the API" - could use Redis, in-memory, file-based, etc.
   - Example: "Improve performance" - many optimization strategies possible

3. **Code Modifications**: Changes that affect existing behavior or structure
   - Example: "Update the login flow" - what exactly should change?
   - Example: "Refactor this component" - what's the target architecture?

4. **Architectural Decisions**: The task requires choosing between patterns or technologies
   - Example: "Add real-time updates" - WebSockets vs SSE vs polling
   - Example: "Implement state management" - Redux vs Context vs custom solution

5. **Multi-File Changes**: The task will likely touch more than 2-3 files
   - Example: "Refactor the authentication system"
   - Example: "Add a new API endpoint with tests"

6. **Unclear Requirements**: You need to explore before understanding the full scope
   - Example: "Make the app faster" - need to profile and identify bottlenecks
   - Example: "Fix the bug in checkout" - need to investigate root cause

7. **User Preferences Matter**: The implementation could reasonably go multiple ways
   - If you would use AskUserQuestion to clarify the approach, use EnterPlanMode instead
   - Plan mode lets you explore first, then present options with context

## When NOT to Use This Tool

Only skip EnterPlanMode for simple tasks:
- Single-line or few-line fixes (typos, obvious bugs, small tweaks)
- Adding a single function with clear requirements
- Tasks where the user has given very specific, detailed instructions
- Pure research/exploration tasks (use the Agent tool with explore agent instead)

## What Happens in Plan Mode

In plan mode, you'll:
1. Thoroughly explore the codebase using Glob, Grep, and Read tools
2. Understand existing patterns and architecture
3. Design an implementation approach
4. Present your plan to the user for approval
5. Use AskUserQuestion if you need to clarify approaches
6. Exit plan mode with ExitPlanMode when ready to implement

## Examples

### GOOD - Use EnterPlanMode:
User: "Add user authentication to the app"
- Requires architectural decisions (session vs JWT, where to store tokens, middleware structure)

User: "Optimize the database queries"
- Multiple approaches possible, need to profile first, significant impact

User: "Implement dark mode"
- Architectural decision on theme system, affects many components

User: "Add a delete button to the user profile"
- Seems simple but involves: where to place it, confirmation dialog, API call, error handling, state updates

User: "Update the error handling in the API"
- Affects multiple files, user should approve the approach

### BAD - Don't use EnterPlanMode:
User: "Fix the typo in the README"
- Straightforward, no planning needed

User: "Add a console.log to debug this function"
- Simple, obvious implementation

User: "What files handle routing?"
- Research task, not implementation planning

## Important Notes

- This tool REQUIRES user approval - they must consent to entering plan mode
- If unsure whether to use it, err on the side of planning - it's better to get alignment upfront than to redo work
- Users appreciate being consulted before significant changes are made to their codebase
</textarea>
