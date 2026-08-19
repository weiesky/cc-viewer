# LSP

Forespørger Language Server Protocol-servere (LSP) for kodeintelligens — definitioner, referencer, hover, symboler, implementeringer og kaldhierarki. Mere præcist end tekstsøgning, fordi det forstår kode semantisk.

## Hvornår skal den bruges

- Spring til et symbols definition (`goToDefinition`) eller find alle referencer (`findReferences`)
- Læs typesignaturer / dokumentation for et symbol (`hover`)
- List symboler i én fil (`documentSymbol`) eller søg efter dem på tværs af projektet (`workspaceSymbol`)
- Find implementeringer af en grænseflade eller abstrakt metode (`goToImplementation`)
- Gennemløb kaldhierarkiet for en funktion (`prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`)

## Aktivering

- Inaktiv, indtil et code-intelligence-plugin til sproget er installeret (serverbinæren installeres separat).
- Værktøjet vises kun, når en LSP-klient er forbundet.

## Parametre

- `operation` (streng, påkrævet): en af de operationer, der er nævnt ovenfor.
- `filePath` (streng, påkrævet): den fil, der skal arbejdes på.
- `line` (tal, påkrævet): 1-baseret linjenummer, som vist i editoren.
- `character` (tal, påkrævet): 1-baseret tegnforskydning, som vist i editoren.

## Noter

- Kræver en konfigureret LSP-server til den filtype; ellers returnerer kaldet en fejl.
- Linje og tegn er 1-baserede (editorkoordinater), ikke 0-baserede.
- Foretræk LSP frem for `Grep`, når du har brug for semantisk navigation (sand definition/reference) frem for et tekstmatch.

## Relaterede begreber

- Supplerer `Read` og `Edit`, når du navigerer i og ændrer kode.
