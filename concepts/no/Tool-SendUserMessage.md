# SendUserMessage

Sender en melding til brukeren — den primære synlige utdatakanalen i brief-aktige sesjoner. Også kjent under sitt legacy-alias `Brief`.

## Når skal den brukes

- Svare på noe brukeren nettopp sa (`status="normal"`).
- Proaktivt vise frem noe brukeren ikke har bedt om, men som må ses nå — en oppgave som fullføres mens de er borte, en blokkering du traff, en uoppfordret statusoppdatering (`status="proactive"`).

## Parametere

I brief-modus:

- `message` (string, påkrevd): Meldingen til brukeren. Støtter markdown-formatering.
- `attachments` (array, valgfri): Vedlegg vist sammen med meldingen. Hver oppføring er enten en filsti (absolutt eller relativ til gjeldende arbeidskatalog) for en lokalt lesbar fil, eller et forhåndsløst `{file_uuid, file_name, size, is_image}`-objekt hentet fra et enhetsverktøy som `attach_file`.
- `status` (string, påkrevd): `proactive` for uoppfordrede oppdateringer brukeren trenger nå; `normal` når du svarer brukeren.

I ikke-brief-bygg er kun `message` tilgjengelig.

## Eksempler

### Eksempel 1: Proaktiv fullføringsmelding

```
SendUserMessage(
  message="The migration finished — 42 files updated, tests green.",
  status="proactive"
)
```

## Notater

- Kun aktivert i brief-modus eller via tilsvarende feature-utrulling; de fleste interaktive CLI-sesjoner snakker med brukeren direkte i stedet.
- Bruk `proactive` sparsomt — den er ment for ting som virkelig trenger brukerens oppmerksomhet nå.
