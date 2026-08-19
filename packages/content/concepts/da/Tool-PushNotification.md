# PushNotification

Sender en skrivebordsnotifikation fra den aktuelle Claude Code-session. Hvis Remote Control er tilsluttet, sendes notifikationen også til brugerens telefon og trækker deres opmærksomhed tilbage til sessionen, uanset hvad de er i gang med.

## Hvornår skal den bruges

- En langvarig opgave er afsluttet, mens brugeren sandsynligvis var væk fra terminalen
- Et build, en testkørsel eller et deployment er gennemført, og resultatet er klar til gennemgang
- Der er nået et beslutningspunkt, der kræver brugerens input, før arbejdet kan fortsætte
- Der er opstået en fejl eller bloker, som ikke kan løses autonomt
- Brugeren har eksplicit bedt om at blive underrettet, når en bestemt opgave eller betingelse er opfyldt

## Hvornår den ikke skal bruges

Send ikke en notifikation for rutinemæssige statusopdateringer midt i en opgave eller for at bekræfte, at du har besvaret noget, som brugeren tydeligvis netop har spurgt om og stadig venter på. Giv ikke besked, når en kort opgave er færdig — hvis brugeren netop har indsendt den og venter, tilføjer en notifikation ingen værdi og underminerer tilliden til fremtidige notifikationer. Hold dig stærkt til ikke at sende.

## Aktivering

- Slået fra som standard (server-side feature-flag).
- Levering kører gennem Anthropic-hostet infrastruktur — ikke tilgængelig på Amazon Bedrock, Claude Platform on AWS, Google Cloud eller Microsoft Foundry.
- Telefon-push kræver desuden en forbundet Remote Control-klient.

## Parametre

- `message` (streng, påkrævet): notifikationens brødtekst. Hold den under 200 tegn; mobile operativsystemer afskærer længere strenge. Begynd med det, brugeren vil handle på: "build failed: 2 auth tests" er mere nyttigt end "task complete".
- `status` (streng, påkrævet): altid sat til `"proactive"`. Dette er en fast markør og ændres ikke.

## Eksempler

### Eksempel 1: notifikation ved afslutning af en lang analyse

En repository-bred afhængighedsrevision blev anmodet om og tog adskillige minutter. Brugeren forlod arbejdspladsen. Når rapporten er klar:

```
message: "Afhængighedsrevision færdig: 3 høj-alvorlige CVE'er i lodash, axios, jsonwebtoken. Rapport: audit-report.txt"
status: "proactive"
```

### Eksempel 2: markering af et beslutningspunkt under autonomt arbejde

Under en flertrinsomlægning opdages det, at to moduler har modstridende grænseflader og ikke kan sammenflettes uden en designbeslutning:

```
message: "Omlægning sat på pause: AuthService og UserService har modstridende token-grænseflader. Din beslutning kræves for at fortsætte."
status: "proactive"
```

## Noter

- Hold dig stærkt til **ikke** at sende. Notifikationen afbryder brugeren uanset hvad de laver. Behandl det som en omkostning, der skal retfærdiggøres af informationens værdi.
- Begynd med handlingsbart indhold. De første ord skal fortælle brugeren, hvad der skete, og hvad de eventuelt skal gøre — ikke en generisk statusetikette.
- Hold `message` under 200 tegn. Mobile operativsystemer afskærer længere strenge og kan fjerne den vigtigste del, hvis den optræder til sidst.
- Hvis resultatet angiver, at pushen ikke blev sendt, fordi Remote Control ikke er tilsluttet, er det forventet adfærd. Der kræves ingen ny forsøg eller opfølgende handling; den lokale skrivebordsnotifikation udløses stadig.
- Undgå notifikationsspam. Hvis der hyppigt sendes notifikationer for mindre hændelser, vil brugeren begynde at ignorere dem. Reservér dette værktøj til situationer, hvor der er en reel chance for, at brugeren er gået, og vil vide resultatet nu.
