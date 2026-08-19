# PushNotification

Sender et skrivebordsvarsel fra den gjeldende Claude Code-økten. Hvis Remote Control er tilkoblet, sendes varselet også til brukerens telefon og trekker oppmerksomheten tilbake til økten uansett hva de holder på med.

## Når skal den brukes

- En langvarig oppgave er fullført mens brukeren sannsynligvis var borte fra terminalen
- Et bygg, en testkjøring eller et utrulling er ferdig og resultatet er klart for gjennomgang
- Det er nådd et beslutningspunkt som krever brukerens innspill før arbeidet kan fortsette
- Det har oppstått en feil eller blokkering som ikke kan løses autonomt
- Brukeren har eksplisitt bedt om å bli varslet når en bestemt oppgave eller betingelse er oppfylt

## Når den ikke skal brukes

Send ikke et varsel for rutinemessige fremdriftsoppdateringer under en oppgave, eller for å bekrefte at du har svart på noe brukeren tydelig nettopp spurte om og fremdeles venter på. Ikke varsle når en kort oppgave er fullført — hvis brukeren nettopp sendte den inn og venter, gir varselet ingen verdi og svekker tilliten til fremtidige varsler. Hel sterkt mot ikke å sende.

## Aktivering

- Av som standard (server-side feature-flag).
- Levering går gjennom Anthropic-hostet infrastruktur — ikke tilgjengelig på Amazon Bedrock, Claude Platform on AWS, Google Cloud eller Microsoft Foundry.
- Telefonpush krever i tillegg en tilkoblet Remote Control-klient.

## Parametere

- `message` (streng, obligatorisk): varselets brødtekst. Hold det under 200 tegn; mobile operativsystemer kutter av lengre strenger. Begynn med det brukeren vil handle på: "build failed: 2 auth tests" er mer nyttig enn "task complete".
- `status` (streng, obligatorisk): alltid satt til `"proactive"`. Dette er en fast markør og endres ikke.

## Eksempler

### Eksempel 1: varsle ved fullføring av en lang analyse

En avhengighetsrevisjon for hele repositoriet ble forespurt og tok flere minutter. Brukeren forlot arbeidsplassen. Når rapporten er klar:

```
message: "Avhengighetsrevisjon ferdig: 3 alvorlige CVEer i lodash, axios, jsonwebtoken. Rapport: audit-report.txt"
status: "proactive"
```

### Eksempel 2: flagge et beslutningspunkt under autonomt arbeid

Under en flerstegs refaktorering oppdages det at to moduler har motstridende grensesnitt og ikke kan slås sammen uten en designbeslutning:

```
message: "Refaktorering satt på pause: AuthService og UserService har motstridende token-grensesnitt. Trenger din beslutning for å fortsette."
status: "proactive"
```

## Notater

- Hel sterkt mot **ikke** å sende. Varselet avbryter brukeren uansett hva de gjør. Behandle det som en kostnad som må rettferdiggjøres av informasjonsverdien.
- Begynn med handlingsbart innhold. De første ordene bør fortelle brukeren hva som skjedde og hva, om noe, de må gjøre — ikke en generisk statusetikett.
- Hold `message` under 200 tegn. Mobile operativsystemer vil kutte av lengre strenger og kan fjerne den viktigste delen hvis den vises til slutt.
- Hvis resultatet indikerer at pushen ikke ble sendt fordi Remote Control ikke er tilkoblet, er det forventet atferd. Ingen nytt forsøk eller oppfølging er nødvendig; det lokale skrivebordsvarsel utløses likevel.
- Unngå varselspam. Hvis det sendes varsler hyppig for mindre hendelser, vil brukeren begynne å ignorere dem. Reserver dette verktøyet for øyeblikk der det er reell sjanse for at brukeren har gått og vil vite resultatet nå.
