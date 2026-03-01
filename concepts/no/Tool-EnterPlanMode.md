# EnterPlanMode

## Definisjon

Bytter Claude Code til planleggingsmodus, for å utforske kodebasen og designe løsninger før implementering.

## Parametere

Ingen parametere.

## Bruksscenarioer

**Egnet for bruk:**
- Implementering av nye funksjoner — krever arkitekturbeslutninger
- Det finnes flere mulige løsninger — krever brukervalg
- Kodeendringer påvirker eksisterende atferd eller struktur
- Endringer i flere filer — kan involvere mer enn 2–3 filer
- Uklare krav — trenger utforskning først for å forstå omfanget
- Brukerpreferanser er viktige — implementeringen kan ha flere rimelige retninger

**Ikke egnet for bruk:**
- Enkeltlinje- eller fålinjefikser (skrivefeil, åpenbare feil)
- Brukeren har gitt svært spesifikke instruksjoner
- Rene forsknings-/utforskningsoppgaver — bruk Task (Explore-type)

## Atferd i planleggingsmodus

Etter å ha gått inn i planleggingsmodus vil Claude Code:
1. Bruke Glob-, Grep- og Read-verktøy for å utforske kodebasen grundig
2. Forstå eksisterende mønstre og arkitektur
3. Designe implementeringsplan
4. Sende planen til brukeren for godkjenning
5. Bruke AskUserQuestion for avklaring ved behov
6. Gå ut via ExitPlanMode når planen er klar

## Merknader

- Dette verktøyet krever brukersamtykke for å gå inn i planleggingsmodus
- Hvis du er usikker på om planlegging er nødvendig, foretrekk planlegging — å justere på forhånd er bedre enn å gjøre om

## Betydning i cc-viewer

EnterPlanMode-kall vises i forespørselsloggen som `tool_use` content block. Etter å ha gått inn i planleggingsmodus består forespørselssekvensene vanligvis hovedsakelig av utforskende verktøykall (Glob, Grep, Read), inntil ExitPlanMode kalles.

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
