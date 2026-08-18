# SendUserFile

Sender én eller flere filer til brukeren — genererte artefakter, skjermbilder, rapporter — med kontroll over hvordan klienten presenterer dem.

## Når skal den brukes

- Du produserte en fil brukeren trenger (en rapport, et bilde, en HTML-side) og vil vise den frem, ikke bare nevne stien.
- Svare med et vedlegg (`status="normal"`), eller proaktivt vise frem noe brukeren ikke har bedt om, men som må ses nå (`status="proactive"`).

## Parametere

- `files` (array av strenger, påkrevd): Filstier (absolutte eller relative til gjeldende arbeidskatalog) som skal sendes til brukeren. Send alltid en array, selv for én enkelt fil.
- `caption` (string, valgfri): Kort bildetekst for filen(e).
- `status` (string, påkrevd): `proactive` når du viser frem en fil brukeren ikke har bedt om, men som må ses nå — en generert artefakt, en fullført rapport; `normal` når du svarer på noe brukeren nettopp sa.
- `display` (string, valgfri): `render` åpner filen inline i sidepanelet (HTML, SVG, Mermaid, bilder, PDF-er); `attach` viser kun et nedlastingskort (leveranser brukeren vil lagre og åpne andre steder). Utelat for å la klienten bestemme ut fra filtype.

## Eksempler

### Eksempel 1: Lever en generert rapport

```
SendUserFile(
  files=["./out/weekly-report.html"],
  caption="Weekly usage report",
  status="proactive",
  display="render"
)
```

## Notater

- Krever at sesjonen tillater filsending (en innstillings-/funksjonsstyrt kapabilitet); tilbys ikke i brief-modus.
- Velg `display="attach"` for filer brukeren lagrer og åpner i en annen app; `render` for alt de bør se på umiddelbart.
