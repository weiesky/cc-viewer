# CronList

Viser alle cron-jobber planlagt via `CronCreate` i gjeldende okt. Returnerer et sammendrag av hvert aktivt cron-job, inkludert `id`, cron-uttrykk, forkortet `prompt`, `recurring`-flagg, `durable`-flagg og neste kjoringstidspunkt.

## Nar skal den brukes

- For a gjennomga alle jobber som er planlagt, for endringer gjores eller okten avsluttes.
- For a finne korrekt `id` for et job for `CronDelete` kalles for a slette det.
- For a feilsoke hvorfor et forventet job aldri ble utlost, ved a bekrefte at det finnes og sjekke neste kjoringstidspunkt.
- For a bekrefte at et engangsjob (ikke-gjenkommende) enna ikke er utlost og fremdeles venter pa kjoring.

## Parametere

Ingen.

## Eksempler

### Eksempel 1: gjennomga alle planlagte jobber

Kall `CronList` uten argumenter for a hente den komplette listen over alle aktive cron-jobber. Svaret inneholder for hvert job dets `id`, cron-uttrykket som definerer tidsplanen, en forkortet versjon av `prompt` det vil kjore, om det er `recurring` (gjenkommende), om det er `durable` (vedvarende pa tvers av omstarter) og neste planlagte kjoringstidspunkt.

### Eksempel 2: finn id-en til en bestemt gjenkommende oppgave

Hvis det er opprettet flere cron-jobber og ett bestemt gjenkommende job ma slettes, kall `CronList` forst. Bla gjennom den returnerte listen for a finne jobbet hvis `prompt`-sammendrag og cron-uttrykk samsvarer med oppgaven som skal fjernes. Kopier dets `id` og send det til `CronDelete`.

## Notater

- Bare jobber opprettet i gjeldende okt vises, med mindre de ble opprettet med `durable: true`, som lar dem overleve omstart av okten.
- `prompt`-feltet i sammendraget er forkortet; det viser bare begynnelsen av den fullstendige promptteksten, ikke hele innholdet.
- Engangsjobber (`recurring` er `false`) som allerede har blitt utlost, slettes automatisk og vises ikke lenger pa listen.
