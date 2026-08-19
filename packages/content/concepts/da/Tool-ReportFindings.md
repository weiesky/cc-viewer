# ReportFindings

Rapportér resultater af kodegennemsyn som en typet, struktureret liste, som værts-brugerfladen renderes lokalt — i stedet for at udskrive dem som chattekst.

## Hvornår skal det bruges

- Afslutning af en kodegennemsyn, hvis aktive instruktioner eksplicit siger at rapportere resultater med dette værktøj
- Omrapportering efter anvendelse af rettelser, når gennemsynets instruktioner til brug beder om det (hver konstateret grund bærer derefter en `outcome`)
- **Ikke** til ad hoc-meninger, almindelige svar eller gennemgang, hvis instruktioner angiver et anderledes outputformat — og aldrig sammen med en tekstduplicering af de samme resultater

## Parametre

- `findings` (array, påkrævet, maks 32): De verificerede resultater, rangeret efter mest alvorlig først — et tomt array, hvis intet overlevede verifikation. Hver konstatering:
  - `file` (streng, påkrævet): Depot-relativ sti.
  - `line` (tal, valgfri): 1-indexeret ankerline.
  - `summary` (streng, påkrævet): En-sætnings redegørelse for defekten.
  - `failure_scenario` (streng, påkrævet): Konkrete input/tilstand → forkert output eller nedbrud.
  - `category` (streng, valgfri): Kort kebab-case-slug, f.eks. `correctness`, `simplification`, `efficiency`, `test-coverage`.
  - `verdict` (streng, valgfri): `CONFIRMED` eller `PLAUSIBLE` — indstillet når et verificerings-pass kørtes; fraværende på inline-only reviews.
  - `outcome` (streng, valgfri): KUN når omrapportering efter rettelser — `fixed`, `skipped`, eller `no_change_needed`.
- `level` (streng, valgfri): Indsatsene niveauet som review kørtes på — `low`, `medium`, `high`, `xhigh`, eller `max`.

## Noter

- **Kald det én gang.** Et enkelt opkald med den komplette, verificerede, alvorlighed-rangerede liste — ikke ét opkald pr. konstatering.
- **Tomt er et gyldigt resultat.** Hvis ingen konstatering overlevede verifikation, rapportér et tomt array i stedet for at polstre med svage resultater.
- **Duplikér ikke i tekst.** Når dette værktøj rapporterer resultaterne, må resultaterne ikke også udskrives som en chatbesked.
- **`outcome` er kun til omrapportering.** På den første rapport lader du det være uindstillet; efter et apply-pass, indstil hvad der faktisk skete med hver konstatering.
