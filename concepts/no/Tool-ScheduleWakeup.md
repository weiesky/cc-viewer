# ScheduleWakeup

Planlegger når arbeidet skal gjenopptas i `/loop` dynamisk modus. Verktøyet lar Claude selvstyre tempoet i oppgaveiterationer ved å sove i det valgte intervallet, deretter utløse igjen med den samme løkke-prompten.

## Når skal den brukes

- For å selvstyre tempoet i en `/loop` dynamisk oppgave der iterasjonsintervallet avhenger av arbeidstilstand snarere enn en fast klokke
- For å vente på at en lang bygging, distribusjon eller testkjøring er ferdig før resultater sjekkes
- For å sette inn tomgangs-ticks mellom iterasjoner når det ikke er et spesifikt signal å overvåke akkurat nå
- For å kjøre en autonom løkke uten brukerprompt — send den bokstavelige sentinel `<<autonomous-loop-dynamic>>` som `prompt`
- For å polle en prosess hvis tilstand er i ferd med å endre seg snart (bruk kort forsinkelse for å holde cachen varm)

## Aktivering

- Ikke tilgjengelig på Amazon Bedrock, Claude Platform on AWS, Google Cloud Agent Platform eller Microsoft Foundry.
- Også av når henting av feature-flags er deaktivert (telemetri-/trafikk-miljøvariabler).

## Parametere

- `delaySeconds` (tall, påkrevd): Sekunder til gjenopptagelse. Kjøretiden begrenser automatisk verdien til `[60, 3600]`, så manuell begrensning er ikke nødvendig.
- `reason` (streng, påkrevd): En kort setning som forklarer den valgte forsinkelsen. Vises til brukeren og registreres i telemetri. Vær spesifikk — "sjekker lang bun-bygging" er mer nyttig enn "venter."
- `prompt` (streng, påkrevd): `/loop`-input som utløses ved oppvåkning. Send den samme strengen hver tur slik at neste utløsning gjentar oppgaven. For en autonom løkke uten brukerprompt sendes den bokstavelige sentinel `<<autonomous-loop-dynamic>>`.

## Eksempler

### Eksempel 1: kort forsinkelse for å sjekke et raskt skiftende signal på nytt (hold cachen varm)

En bygging ble nettopp startet og tar vanligvis to til tre minutter.

```json
{
  "delaySeconds": 120,
  "reason": "sjekker bun-bygging forventet ferdig om ~2 min",
  "prompt": "sjekk byggstatus og rapporter eventuelle feil"
}
```

120 sekunder holder samtalekonteksten i Anthropic prompt-cachen (TTL 5 min), så neste oppvåkning er raskere og billigere.

### Eksempel 2: lang tomgangs-tick (aksepter cache-miss, amortiser over lengre ventetid)

En databasemigrering kjører og tar vanligvis 20–40 minutter.

```json
{
  "delaySeconds": 1200,
  "reason": "migrering tar vanligvis 20–40 min; sjekker igjen om 20 min",
  "prompt": "sjekk migrasjonsstatus og fortsett hvis ferdig"
}
```

Cachen vil være kald ved oppvåkning, men 20-minutters ventetiden amortiserer mer enn tilstrekkelig den enkle cache-missen. Å polle hvert 5. minutt ville betale den samme miss-prisen 4 ganger uten fordel.

## Notater

- **5-minutters cache-TTL**: Anthropic prompt-cachen utløper etter 300 sekunder. Forsinkelser under 300 s holder konteksten varm; forsinkelser over 300 s medfører en cache-miss ved neste oppvåkning.
- **Unngå nøyaktig 300 s**: Det er det verste fra begge verdener — man betaler cache-missen uten å få en meningsfull lengre ventetid. Enten drop til 270 s (hold cachen varm) eller forplikter til 1200 s eller mer (én miss kjøper en mye lengre ventetid).
- **Standard for tomgangs-ticks**: Når det ikke er et spesifikt signal å overvåke, bruk **1200–1800 s** (20–30 min). Dette lar løkken sjekke periodisk uten å brenne cachen 12 ganger i timen for ingenting.
- **Automatisk begrensning**: Kjøretiden begrenser `delaySeconds` til `[60, 3600]`. Verdier under 60 blir til 60; verdier over 3600 blir til 3600. Det er ikke nødvendig å håndtere disse grensene selv.
- **Utelat kallet for å avslutte løkken**: Hvis iterasjoner skal stoppes, skal ikke ScheduleWakeup kalles. Å bare utelate kallet avslutter løkken.
- **Send den samme `prompt` hver tur**: `prompt`-feltet må bære den originale `/loop`-instruksjonen ved hver invokasjon slik at neste oppvåkning vet hvilken oppgave som skal gjenopptas.
