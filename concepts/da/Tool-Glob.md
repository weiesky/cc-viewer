# Glob

## Definition

Hurtigt filnavnsmønster-matchningsværktøj, der understøtter kodebaser af enhver størrelse. Returnerer matchende filstier sorteret efter ændringstidspunkt.

## Parametre

| Parameter | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `pattern` | string | Ja | Glob-mønster (f.eks. `**/*.js`, `src/**/*.ts`) |
| `path` | string | Nej | Søgemappe, standard er den aktuelle arbejdsmappe. Send ikke "undefined" eller "null" |

## Brugsscenarier

**Egnet til:**
- Søge filer efter filnavnsmønster
- Finde alle filer af en bestemt type (f.eks. alle `.tsx`-filer)
- Lokalisere filer når man søger efter en bestemt klassedefinition (f.eks. `class Foo`)
- Man kan starte flere Glob-kald parallelt i en enkelt besked

**Ikke egnet til:**
- Søge filindhold — brug Grep
- Åben udforskning der kræver flere søgerunder — brug Task (Explore-type)

## Bemærkninger

- Understøtter standard glob-syntaks: `*` matcher ét niveau, `**` matcher flere niveauer, `{}` matcher flervalg
- Resultater sorteres efter ændringstidspunkt
- Mere anbefalet end Bashs `find`-kommando

## Betydning i cc-viewer

Glob-kald vises i requestloggen som `tool_use` / `tool_result` content block-par. `tool_result` indeholder listen over matchende filstier.

## Originaltekst

<textarea readonly>- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
- You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.</textarea>
