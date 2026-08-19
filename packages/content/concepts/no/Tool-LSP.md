# LSP

Spør Language Server Protocol-servere (LSP) om kodeintelligens — definisjoner, referanser, hover, symboler, implementeringer og kallhierarki. Mer presist enn tekstsøk fordi det forstår kode semantisk.

## Når skal den brukes

- Hopp til et symbols definisjon (`goToDefinition`) eller finn alle referanser (`findReferences`)
- Les typesignaturer / dokumentasjon for et symbol (`hover`)
- List symboler i én fil (`documentSymbol`) eller søk etter dem på tvers av prosjektet (`workspaceSymbol`)
- Finn implementeringer av et grensesnitt eller en abstrakt metode (`goToImplementation`)
- Gå gjennom kallhierarkiet til en funksjon (`prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`)

## Aktivering

- Inaktiv inntil en kodeintelligens-plugin for språket er installert (serverbinæren installeres separat).
- Verktøyet vises kun når en LSP-klient er tilkoblet.

## Parametere

- `operation` (streng, påkrevd): en av operasjonene nevnt ovenfor.
- `filePath` (streng, påkrevd): filen det skal arbeides på.
- `line` (tall, påkrevd): 1-basert linjenummer, slik det vises i editoren.
- `character` (tall, påkrevd): 1-basert tegnforskyvning, slik det vises i editoren.

## Notater

- Krever en konfigurert LSP-server for den filtypen; ellers returnerer kallet en feil.
- Linje og tegn er 1-baserte (editorkoordinater), ikke 0-baserte.
- Foretrekk LSP fremfor `Grep` når du trenger semantisk navigasjon (sann definisjon/referanse) i stedet for et tekstmatch.

## Relaterte begreper

- Utfyller `Read` og `Edit` når du navigerer i og endrer kode.
