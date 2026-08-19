# Glob

Matcher filnavne mod et glob-mønster og returnerer stierne sorteret efter seneste ændringstidspunkt først. Optimeret til hurtigt at lokalisere filer i kodebaser af enhver størrelse uden at skulle gå til `find` via shell.

## Hvornår skal den bruges

- Opremse hver fil af en specifik udvidelse (for eksempel alle `*.ts`-filer under `src`)
- Opdage konfigurations- eller fixture-filer ved navnekonvention (`**/jest.config.*`, `**/*.test.tsx`)
- Indsnævre et søgeoverflade før en målrettet `Grep`
- Tjekke om en fil allerede eksisterer ved et kendt mønster før kald af `Write`
- Finde nyligt ændrede filer ved at læne sig op ad ændringstidssorteringen

## Parametre

- `pattern` (string, påkrævet): Det glob-udtryk, der skal matches. Understøtter `*` for enkeltsegments-wildcards, `**` for rekursive match og `{a,b}` for alternativer, for eksempel `src/**/*.{ts,tsx}`.
- `path` (string, valgfri): Mappe, som søgningen køres i. Skal være en gyldig mappesti, når angivet. Udelad feltet helt for at søge i den aktuelle arbejdsmappe. Send ikke strengene `"undefined"` eller `"null"`.

## Eksempler

### Eksempel 1: Hver TypeScript-kildefil
Kald `Glob` med `pattern: "src/**/*.ts"`. Resultatet er en mtime-sorteret liste, så de senest redigerede filer vises først, hvilket er nyttigt til at fokusere på hotspots.

### Eksempel 2: Find en kandidat til en klassedefinition
Når du mistænker, at en klasse ligger i en fil, hvis navn du ikke kender, så søg med `pattern: "**/*UserService*"` for at indsnævre kandidaterne, og følg op med `Read` eller `Grep`.

### Eksempel 3: Parallel opdagelse før en større opgave
I en enkelt besked kan du udstede flere `Glob`-kald (for eksempel et for `**/*.test.ts` og et for `**/fixtures/**`), så begge kører parallelt, og deres resultater kan korreleres.

## Noter

- Resultater er sorteret efter filens ændringstid (nyeste først), ikke alfabetisk. Sortér nedstrøms, hvis du har brug for stabil rækkefølge.
- Mønstre evalueres af værktøjet, ikke af skallen; du behøver ikke at sætte dem i anførselstegn eller escape dem som på kommandolinjen.
- Til åben udforskning, der kræver flere runder af søgning og ræsonnement, delegér til en `Agent` med Explore-agenttypen i stedet for at kæde mange `Glob`-kald.
- Foretræk `Glob` frem for `Bash`-kald af `find` eller `ls` til filnavnsopdagelse; det håndterer tilladelser konsekvent og returnerer struktureret output.
- Når du leder efter indhold inde i filer frem for filnavne, brug `Grep` i stedet.
