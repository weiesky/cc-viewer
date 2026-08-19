# CronList

Viser alle cron-jobs planlagt via `CronCreate` i den aktuelle session. Returnerer et overblik over hvert aktivt cron-job, herunder `id`, cron-udtryk, forkortet `prompt`, `recurring`-flag, `durable`-flag og naeste udlosningstidspunkt.

## Hvornår skal den bruges

- For at gennemse alle aktuelt planlagte jobs, inden der foretages aendringer eller sessionen afsluttes.
- For at finde det korrekte `id` pa et job, inden `CronDelete` kaldes for at slette det.
- For at fejlfinde, hvorfor et forventet job aldrig blev udlost, ved at bekrafte dets eksistens og kontrollere naeste udlosningstidspunkt.
- For at bekrafte, at et engangsjob (ikke-tilbagevendende) endnu ikke er blevet udlost og stadig afventer udforsel.

## Parametre

Ingen.

## Eksempler

### Eksempel 1: gennemse alle planlagte jobs

Kald `CronList` uden argumenter for at hente den komplette liste over alle aktive cron-jobs. Svaret indeholder for hvert job dets `id`, det cron-udtryk der definerer planen, en forkortet udgave af det `prompt` det vil udfore, om det er `recurring` (tilbagevendende), om det er `durable` (vedvarende pa tvars af genstarter) og naeste planlagte udlosningstidspunkt.

### Eksempel 2: find id'et pa en bestemt tilbagevendende opgave

Hvis der er oprettet flere cron-jobs og et bestemt tilbagevendende job skal slettes, skal `CronList` kaldes forst. Gennemsa den returnerede liste for at finde det job, hvis `prompt`-oversigt og cron-udtryk matcher den opgave, der skal fjernes. Kopieer dets `id` og send det til `CronDelete`.

## Noter

- Kun jobs oprettet i den aktuelle session vises, medmindre de er oprettet med `durable: true`, som gor det muligt for dem at overleve sessionsgenstart.
- Feltet `prompt` i oversigtsen er forkortet; det viser kun begyndelsen af den fulde prompttekst, ikke hele indholdet.
- Engangsjobs (`recurring` er `false`), der allerede er blevet udlost, slettes automatisk og vises ikke laengere pa listen.
