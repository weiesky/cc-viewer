# AskUserQuestion

## Definisjon

Stiller spørsmål til brukeren under utførelse, for å få avklaringer, verifisere antakelser eller be om beslutninger.

## Parametere

| Parameter | Type | Påkrevd | Beskrivelse |
|-----------|------|---------|-------------|
| `questions` | array | Ja | Spørsmålsliste (1–4 spørsmål) |
| `answers` | object | Nei | Svar samlet inn fra brukeren |
| `annotations` | object | Nei | Merknader for hvert spørsmål (f.eks. notater for forhåndsvisning av valg) |
| `metadata` | object | Nei | Metadata for sporing og analyse |

Hvert `question`-objekt:

| Felt | Type | Påkrevd | Beskrivelse |
|------|------|---------|-------------|
| `question` | string | Ja | Fullstendig spørsmålstekst, bør ende med spørsmålstegn |
| `header` | string | Ja | Kort etikett (maks 12 tegn), vises som etikett-chip |
| `options` | array | Ja | 2–4 alternativer |
| `multiSelect` | boolean | Ja | Om flervalg er tillatt |

Hvert `option`-objekt:

| Felt | Type | Påkrevd | Beskrivelse |
|------|------|---------|-------------|
| `label` | string | Ja | Visningstekst for alternativet (1–5 ord) |
| `description` | string | Ja | Beskrivelse av alternativet |
| `markdown` | string | Nei | Forhåndsvisningsinnhold (for visuell sammenligning av ASCII-layout, kodesnutter osv.) |

## Bruksscenarioer

**Egnet for bruk:**
- Samle inn brukerpreferanser eller krav
- Avklare tvetydige instruksjoner
- Få beslutninger under implementering
- Gi brukeren retningsvalg

**Ikke egnet for bruk:**
- Spørre "er planen OK?" — bruk ExitPlanMode

## Merknader

- Brukeren kan alltid velge "Other" for å gi egendefinert inndata
- Anbefalt alternativ plasseres først, med "(Recommended)" lagt til på slutten av label
- `markdown`-forhåndsvisning støttes kun for enkeltvalg-spørsmål
- Alternativer med `markdown` bytter til side-ved-side-layout
- I planleggingsmodus brukes dette til å avklare krav før planen fastsettes

## Betydning i cc-viewer

AskUserQuestion-kall vises i forespørselsloggen som `tool_use` content block, som inneholder spørsmåls- og alternativdefinisjoner. Brukerens svar vises i meldingshistorikken for påfølgende forespørsler.

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
