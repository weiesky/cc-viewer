# CronDelete

Avbryter en cron-jobb som tidligere ble planlagt med `CronCreate`. Fjerner den umiddelbart fra den minnebaserte sesjonslagringen. Har ingen effekt hvis jobben allerede er automatisk slettet (engangsjobber fjernes etter at de utløses, gjentakende jobber utløper etter 7 dager).

## Når skal den brukes

- En bruker ber om å stoppe en gjentakende planlagt oppgave før den automatiske utløpet etter 7 dager.
- En engangjobb er ikke lenger nødvendig og bør avbrytes før den utløses.
- Planleggingsuttrykket for en eksisterende jobb må endres — slett den med `CronDelete`, deretter gjenopprett den med `CronCreate` ved å bruke det nye uttrykket.
- Rydde opp i flere utdaterte jobber for å holde sesjonslagringen ryddig.

## Parametere

- `id` (string, påkrevd): Jobb-ID-en returnert av `CronCreate` da jobben først ble opprettet. Denne verdien må samsvare nøyaktig; uklar søking eller navnebasert oppslag støttes ikke.

## Eksempler

### Eksempel 1: avbryt en kjørende gjentakende jobb

En gjentakende jobb ble tidligere opprettet med ID `"cron_abc123"`. Brukeren ber om å stoppe den.

```
CronDelete({ id: "cron_abc123" })
```

Jobben fjernes fra sesjonslagringen og vil ikke utløses igjen.

### Eksempel 2: fjern en utdatert engangjobb før den utløses

En engangjobb med ID `"cron_xyz789"` ble planlagt til å kjøre om 30 minutter, men brukeren har bestemt at den ikke lenger er nødvendig.

```
CronDelete({ id: "cron_xyz789" })
```

Jobben avbrytes. Ingen handling vil bli utført når det opprinnelige utløsningstidspunktet nås.

## Notater

- `id` må hentes fra returverdien til `CronCreate`. Det er ingen måte å søke opp en jobb etter beskrivelse eller tilbakeringing — lagre ID-en hvis du kanskje trenger å avbryte den senere.
- Hvis jobben allerede er automatisk slettet (utløst som en engangjobb, eller nådd den gjentakende utløpet etter 7 dager), er kall av `CronDelete` med den ID-en en no-op og vil ikke produsere en feil.
- `CronDelete` påvirker bare den nåværende minnebaserte sesjonen. Hvis kjøretidsmiljøet ikke bevarer cron-tilstanden på tvers av omstarter, vil planlagte jobber gå tapt ved omstart uavhengig av om `CronDelete` ble kalt.
- Det finnes ingen masseoperasjon for sletting; avbryt hver jobb individuelt ved å bruke dens egen `id`.
