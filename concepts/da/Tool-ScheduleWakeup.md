# ScheduleWakeup

Planlægger hvornår arbejdet skal genoptages i `/loop` dynamisk tilstand. Værktøjet giver Claude mulighed for at selvstyre tempoet i opgaveiterationer ved at sove i det valgte interval og derefter udløse igen med den samme loop-prompt.

## Hvornår skal den bruges

- Til at selvstyre tempoet i en `/loop` dynamisk opgave, hvor iterationsintervallet afhænger af arbejdstilstand snarere end et fast ur
- Til at vente på, at en lang build, deployment eller testkørsel er færdig, inden resultater kontrolleres
- Til at indsætte tomgangsticks mellem iterationer, når der ikke er noget specifikt signal at overvåge på nuværende tidspunkt
- Til at køre en autonom løkke uden bruger-prompt — send det bogstavelige sentinel `<<autonomous-loop-dynamic>>` som `prompt`
- Til at polle en proces, hvis tilstand er ved at ændre sig snart (brug en kort forsinkelse for at holde cachen varm)

## Aktivering

- Ikke tilgængelig på Amazon Bedrock, Claude Platform on AWS, Google Cloud Agent Platform eller Microsoft Foundry.
- Også slået fra, når feature-flag-hentning er deaktiveret (telemetri-/trafik-miljøvariabler).

## Parametre

- `delaySeconds` (tal, påkrævet): Sekunder til genoptagelse. Runtime begrænser automatisk værdien til `[60, 3600]`, så manuel begrænsning er ikke nødvendig.
- `reason` (streng, påkrævet): En kort sætning, der forklarer den valgte forsinkelse. Vises til brugeren og registreres i telemetri. Vær specifik — "kontrollerer lang bun-build" er mere nyttigt end "venter."
- `prompt` (streng, påkrævet): `/loop`-inputtet der udløses ved opvågning. Send den samme streng hver tur, så det næste udløsning gentager opgaven. For en autonom løkke uden bruger-prompt sendes det bogstavelige sentinel `<<autonomous-loop-dynamic>>`.

## Eksempler

### Eksempel 1: kort forsinkelse for at genkontrollere et hurtigt skiftende signal (hold cachen varm)

En build er netop startet og tager typisk to til tre minutter.

```json
{
  "delaySeconds": 120,
  "reason": "kontrollerer bun-build forventet færdig om ~2 min",
  "prompt": "kontroller build-status og rapporter eventuelle fejl"
}
```

120 sekunder holder samtalekonteksten i Anthropic prompt-cachen (TTL 5 min), så den næste opvågning er hurtigere og billigere.

### Eksempel 2: langt tomgangstick (accepter cache-miss, amortiser over længere ventetid)

En databasemigrering kører og tager typisk 20–40 minutter.

```json
{
  "delaySeconds": 1200,
  "reason": "migrering tager typisk 20–40 min; kontrollerer igen om 20 min",
  "prompt": "kontroller migrationsstatus og fortsæt hvis færdig"
}
```

Cachen vil være kold ved opvågning, men 20-minutters ventetiden amortiserer mere end rigeligt det enkle cache-miss. At polle hvert 5. minut ville betale den samme miss-pris 4 gange uden fordel.

## Noter

- **5-minutters cache-TTL**: Anthropic prompt-cachen udløber efter 300 sekunder. Forsinkelser under 300 s holder konteksten varm; forsinkelser over 300 s medfører et cache-miss ved næste opvågning.
- **Undgå præcis 300 s**: Det er det værste fra begge verdener — man betaler cache-misset uden at få en meningsfuldt længere ventetid. Enten drop til 270 s (hold cachen varm) eller forpligt til 1200 s eller mere (ét miss køber en meget længere ventetid).
- **Standard for tomgangsticks**: Når der ikke er noget specifikt signal at overvåge, brug **1200–1800 s** (20–30 min). Dette lader løkken tjekke periodisk uden at brænde cachen 12 gange i timen for ingenting.
- **Automatisk begrænsning**: Runtime begrænser `delaySeconds` til `[60, 3600]`. Værdier under 60 bliver til 60; værdier over 3600 bliver til 3600. Det er ikke nødvendigt at håndtere disse grænser selv.
- **Udelad kaldet for at afslutte løkken**: Hvis iterationer skal stoppes, skal ScheduleWakeup ikke kaldes. Blot at udelade kaldet afslutter løkken.
- **Send den samme `prompt` hver tur**: `prompt`-feltet skal bære den originale `/loop`-instruktion ved hver invokation, så den næste opvågning ved, hvilken opgave der skal genoptages.
