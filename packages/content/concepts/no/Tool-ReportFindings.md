# ReportFindings

Rapporter kodegjennomsyn funn som en typet, strukturert liste som verts-brukerflaten gjengi innholdsrik — i stedet for å skrive dem som chattekst.

## Når skal den brukes

- Konkludering av en kodegjennomgang hvis aktive instruksjoner eksplisitt sier å rapportere funn med dette verktøyet
- Omrapportering etter bruk av rettelser, når gjennomgangens bruksinstruksjoner spør om det (hvert funn bærer da en `outcome`)
- **Ikke** for ad hoc-meninger, ordinære svar eller gjennomgang hvis instruksjoner spesifiserer et annet utdataformat — og aldri sammen med en tekstduplisering av de samme funnene

## Parametere

- `findings` (array, påkrevd, maks 32): De verifiserte funnene, rangert mest alvorlig først — et tomt array hvis ingenting overlevde verifisering. Hvert funn:
  - `file` (streng, påkrevd): Depo-relativ sti.
  - `line` (tall, valgfri): 1-indeksert ankerlinjen.
  - `summary` (streng, påkrevd): En-setnings uttalelse av defekten.
  - `failure_scenario` (streng, påkrevd): Konkrete inndata/tilstand → feil utdata eller krasj.
  - `category` (streng, valgfri): Kort kebab-case slug, f.eks. `correctness`, `simplification`, `efficiency`, `test-coverage`.
  - `verdict` (streng, valgfri): `CONFIRMED` eller `PLAUSIBLE` — sett når en verifiseringskjøring kjørte; fraværende på inline-bare gjennomganger.
  - `outcome` (streng, valgfri): BARE når omrapportering etter rettelser — `fixed`, `skipped`, eller `no_change_needed`.
- `level` (streng, valgfri): Innsatsgradenivået som gjennomgangen kjørte på — `low`, `medium`, `high`, `xhigh`, eller `max`.

## Notater

- **Kall det en gang.** Et enkelt oppkall med den komplette, verifiserte, alvorlighet-rangerte listen — ikke ett oppkall per funn.
- **Tomt er et gyldig resultat.** Hvis ingen funn overlevde verifisering, rapporter et tomt array i stedet for å polstre med svake funn.
- **Ikke dupliser i tekst.** Når dette verktøyet rapporterer resultatene, må funnene ikke også skrives ut som en chatmelding.
- **`outcome` er bare for omrapportering.** På første rapport lar du det være ikke satt; etter et apply-pass, sett hva som faktisk skjedde med hvert funn.
