# SendUserFile

Sender en eller flere filer til brugeren — genererede artefakter, skærmbilleder, rapporter — med kontrol over, hvordan klienten præsenterer dem.

## Hvornår skal den bruges

- Du har produceret en fil, brugeren har brug for (en rapport, et billede, en HTML-side), og vil vise den frem, ikke bare nævne dens sti.
- At svare med en vedhæftning (`status="normal"`) eller proaktivt vise noget frem, brugeren ikke har bedt om, men har brug for at se nu (`status="proactive"`).

## Parametre

- `files` (array af strings, påkrævet): Filstier (absolutte eller relative i forhold til cwd), der skal sendes til brugeren. Send altid et array, selv for en enkelt fil.
- `caption` (string, valgfri): Kort billedtekst til filen/filerne.
- `status` (string, påkrævet): `proactive`, når du viser en fil frem, brugeren ikke har bedt om og har brug for at se nu — en genereret artefakt, en færdig rapport; `normal`, når du svarer på noget, brugeren lige sagde.
- `display` (string, valgfri): `render` åbner filen inline i sidepanelet (HTML, SVG, Mermaid, billeder, PDF'er); `attach` viser kun et download-kort (leverancer, brugeren gemmer og åbner et andet sted). Udelad for at lade klienten bestemme ud fra filtype.

## Eksempler

### Eksempel 1: Levér en genereret rapport

```
SendUserFile(
  files=["./out/weekly-report.html"],
  caption="Weekly usage report",
  status="proactive",
  display="render"
)
```

## Noter

- Kræver, at sessionen tillader afsendelse af filer (en settings-/feature-gated kapacitet); tilbydes ikke i brief-tilstand.
- Vælg `display="attach"` til filer, brugeren gemmer og åbner i en anden app; `render` til alt, de bør se på med det samme.
