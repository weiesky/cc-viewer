# CronDelete

Annullerer et cron-job, der tidligere er planlagt med `CronCreate`. Fjerner det øjeblikkeligt fra den in-memory sessionslager. Har ingen effekt, hvis jobbet allerede er blevet automatisk slettet (enkeltudløsende job fjernes efter udløsning, tilbagevendende job udløber efter 7 dage).

## Hvornår skal den bruges

- En bruger beder om at stoppe en tilbagevendende planlagt opgave inden den automatiske udløb efter 7 dage.
- Et enkeltudløsende job er ikke længere nødvendigt og skal annulleres, inden det udløses.
- Tidsplanudtrykket for et eksisterende job skal ændres — slet det med `CronDelete`, og opret det derefter igen med `CronCreate` ved hjælp af det nye udtryk.
- Rydde op i flere forældede job for at holde sessionsslageret ryddeligt.

## Parametre

- `id` (string, påkrævet): Job-ID'et returneret af `CronCreate`, da jobbet første gang blev oprettet. Denne værdi skal matche præcist; uklar søgning eller navnebaseret opslag understøttes ikke.

## Eksempler

### Eksempel 1: annuller et kørende tilbagevendende job

Et tilbagevendende job blev tidligere oprettet med ID `"cron_abc123"`. Brugeren beder om at stoppe det.

```
CronDelete({ id: "cron_abc123" })
```

Jobbet fjernes fra sessionsslageret og vil ikke udløses igen.

### Eksempel 2: fjern et forældet enkeltudløsende job, inden det udløses

Et enkeltudløsende job med ID `"cron_xyz789"` var planlagt til at køre om 30 minutter, men brugeren har besluttet, at det ikke længere er nødvendigt.

```
CronDelete({ id: "cron_xyz789" })
```

Jobbet annulleres. Der vil ikke blive udført nogen handling, når det oprindelige udløsningstidspunkt nås.

## Noter

- `id` skal hentes fra returværdien af `CronCreate`. Der er ingen måde at slå et job op efter beskrivelse eller callback — gem ID'et, hvis du måske har brug for at annullere det senere.
- Hvis jobbet allerede er blevet automatisk slettet (udløst som et enkeltudløsende job eller nået den tilbagevendende udløb efter 7 dage), er kald af `CronDelete` med det ID en no-op og producerer ikke en fejl.
- `CronDelete` påvirker kun den aktuelle in-memory session. Hvis kørselsomgivelsen ikke bevarer cron-tilstanden på tværs af genstarter, vil planlagte job gå tabt ved genstart, uanset om `CronDelete` blev kaldt.
- Der er ingen masseoperationer for sletning; annuller hvert job individuelt ved hjælp af dets eget `id`.
