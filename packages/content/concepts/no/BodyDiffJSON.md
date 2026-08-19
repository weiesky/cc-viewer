# Body Diff JSON (inkrementell sammenligning av forespørselskropp)

## Bakgrunn

MainAgent i Claude Code bruker en mekanisme for sending av full kontekst — hver forespørsel inneholder komplett samtalehistorikk, system prompt, verktøydefinisjoner osv. Dette betyr at forespørselskroppen blir stadig større etter hvert som samtalen skrider frem, og det er vanskelig å raskt finne ut "hva som faktisk er nytt i denne runden" ved å se på rå Body direkte.

Body Diff JSON er laget for å løse dette problemet: den sammenligner automatisk to påfølgende MainAgent-forespørsler og trekker ut den inkrementelle delen, slik at du med ett blikk kan se hva som faktisk er nytt i denne forespørselen.

## Virkemåte

1. **Identifisere påfølgende MainAgent-forespørsler**: Gjeldende forespørsel må være av typen MainAgent, og det må finnes en tidligere MainAgent-forespørsel
2. **Felt-for-felt-sammenligning**: Alle toppnivåfelt i forespørselskroppen gjennomgås, interne egenskaper med `_`-prefiks hoppes over
3. **Smart differanseekstraksjon**:
   - Nye felt: vises direkte
   - Slettede felt: vises ikke (påvirker vanligvis ikke forståelsen)
   - Endrede felt: gjeldende verdi vises
   - Spesialhåndtering av `messages`-arrayen: bare nye meldinger vises (fordi normal samtale bruker tilleggsmodus, og prefiks-meldinger forblir uendret)
4. **Deteksjon av krympet forespørselskropp**: Hvis gjeldende forespørselskropp er mindre enn den forrige, betyr det at kontekstavkorting eller sesjonstilbakestilling har skjedd, og da vises en informasjonsmelding i stedet for diff

## Typiske scenarioer

I en normal samtalerunde inneholder Body Diff JSON vanligvis:
- `messages`: 1–2 nye meldinger (brukerens inndata + assistentens svar fra forrige runde)

Hvis du ser endringer i felt som `system`, `tools` eller `model` i diffen, betyr det at en konfigurasjonsendring har skjedd i denne runden, noe som ofte er årsaken til cache-gjenoppbygging.

## Bruk

- Body Diff JSON vises i detaljpanelet for MainAgent-forespørselen
- Klikk på tittelen for å utvide/skjule
- Støtter JSON- og Text-visningsmodus, samt kopiering med ett klikk
- I **CC-Viewer → Globale innstillinger** øverst til venstre kan du angi "Utvid Body Diff JSON som standard"
