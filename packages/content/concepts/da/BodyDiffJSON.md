# Body Diff JSON (inkrementel sammenligning af request body)

## Baggrund

Claude Codes MainAgent bruger en mekanisme med fuld kontekstafsendelse — hver request inkluderer den komplette samtalehistorik, system prompt, værktøjsdefinitioner osv. Det betyder, at efterhånden som samtalen skrider frem, bliver request body stadigt større, og det bliver svært hurtigt at finde ud af "hvad blev der tilføjet i denne runde" ved at se på den rå Body.

Body Diff JSON er skabt netop for at løse dette problem: den sammenligner automatisk body fra to på hinanden følgende MainAgent-requests og udtrækker den inkrementelle del, så du med ét blik kan se det faktisk tilføjede indhold i denne request.

## Sådan fungerer det

1. **Identificering af på hinanden følgende MainAgent-requests**: den aktuelle request skal være af typen MainAgent, og der skal eksistere en tidligere MainAgent-request
2. **Felt-for-felt sammenligning**: alle felter på øverste niveau i request body gennemgås, og interne egenskaber med `_`-præfiks springes over
3. **Intelligent forskeludtrækning**:
   - Tilføjede felter: vises direkte
   - Fjernede felter: vises ikke (påvirker normalt ikke forståelsen)
   - Ændrede felter: den aktuelle værdi vises
   - Særlig behandling af `messages`-arrayet: kun tilføjede beskeder vises (da normal samtale er i tilføjelsestilstand, og præfiksbeskeder forbliver uændrede)
4. **Registrering af body-reduktion**: hvis den aktuelle request body er mindre end den forrige, betyder det, at der er sket en kontekstafkortning eller sessionsreset; i så fald vises en informationsbesked i stedet for diff

## Typiske scenarier

I en normal samtalerunde indeholder Body Diff JSON normalt kun:
- `messages`: 1~2 tilføjede beskeder (brugerens input + assistentens svar fra forrige runde)

Hvis du ser ændringer i felter som `system`, `tools`, `model` i diff'en, betyder det, at der er sket en konfigurationsændring i denne runde, hvilket ofte også er årsagen til cache-genopbygning.

## Brug

- Body Diff JSON vises i detaljepanelet for MainAgent-requesten
- Klik på titlen for at udvide/skjule
- Understøtter to visningstilstande, JSON og Text, samt kopiering med ét klik
- Øverst til venstre under **CC-Viewer → Globale indstillinger** kan du indstille "Udvid Body Diff JSON som standard"
