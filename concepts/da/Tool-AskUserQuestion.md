# AskUserQuestion

## Definition

Stiller spørgsmål til brugeren under udførelsen for at få afklaring, verificere antagelser eller anmode om beslutninger.

## Parametre

| Parameter | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `questions` | array | Ja | Liste af spørgsmål (1-4 spørgsmål) |
| `answers` | object | Nej | Svar indsamlet fra brugeren |
| `annotations` | object | Nej | Annotationer for hvert spørgsmål (f.eks. noter til forhåndsvisning af valg) |
| `metadata` | object | Nej | Metadata til sporing og analyse |

Hvert `question`-objekt:

| Felt | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `question` | string | Ja | Komplet spørgsmålstekst, skal slutte med spørgsmålstegn |
| `header` | string | Ja | Kort label (maks. 12 tegn), vises som label-chip |
| `options` | array | Ja | 2-4 valgmuligheder |
| `multiSelect` | boolean | Ja | Om flervalg er tilladt |

Hvert `option`-objekt:

| Felt | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `label` | string | Ja | Visningstekst for valgmuligheden (1-5 ord) |
| `description` | string | Ja | Beskrivelse af valgmuligheden |
| `markdown` | string | Nej | Forhåndsvisningsindhold (til visuel sammenligning af ASCII-layout, kodestykker osv.) |

## Brugsscenarier

**Egnet til:**
- Indsamling af brugerpræferencer eller krav
- Afklaring af tvetydige instruktioner
- Indhentning af beslutninger under implementering
- Give brugeren retningsvalg

**Ikke egnet til:**
- At spørge "er planen OK?" — brug ExitPlanMode

## Bemærkninger

- Brugeren kan altid vælge "Other" for at give brugerdefineret input
- Den anbefalede valgmulighed placeres først med "(Recommended)" i slutningen af label
- `markdown`-forhåndsvisning understøttes kun for enkeltvalgs-spørgsmål
- Valgmuligheder med `markdown` skifter til side-om-side-layout
- I planlægningstilstand bruges det til at afklare krav, før planen fastlægges

## Betydning i cc-viewer

AskUserQuestion-kald vises i requestloggen som `tool_use` content block, der indeholder spørgsmåls- og valgmulighedsdefinitioner. Brugerens svar vises i beskedhistorikken for efterfølgende requests.

## Originaltekst

<textarea readonly>Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

Plan mode note: In plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?" or "Should I proceed?" - use ExitPlanMode for plan approval. IMPORTANT: Do not reference "the plan" in your questions (e.g., "Do you have feedback about the plan?", "Does the plan look good?") because the user cannot see the plan in the UI until you call ExitPlanMode. If you need plan approval, use ExitPlanMode instead.

Preview feature:
Use the optional `markdown` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

When any option has a markdown, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).
</textarea>
