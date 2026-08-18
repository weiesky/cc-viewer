# SendUserMessage

Sender en besked til brugeren — den primære synlige output-kanal i brief-stil-sessioner. Også kendt under sit legacy-alias `Brief`.

## Hvornår skal den bruges

- At svare på noget, brugeren lige sagde (`status="normal"`).
- Proaktivt at vise noget frem, brugeren ikke har bedt om og har brug for at se nu — en opgave, der færdiggøres, mens de er væk, en blokering, du ramte, en uopfordret statusopdatering (`status="proactive"`).

## Parametre

I brief-tilstand:

- `message` (string, påkrævet): Beskeden til brugeren. Understøtter markdown-formatering.
- `attachments` (array, valgfri): Vedhæftninger vist sammen med beskeden. Hver post er enten en filsti (absolut eller relativ i forhold til cwd) til en lokalt læsbar fil, eller et forud-opløst `{file_uuid, file_name, size, is_image}`-objekt hentet fra et enhedsværktøj såsom `attach_file`.
- `status` (string, påkrævet): `proactive` til uopfordrede opdateringer, brugeren har brug for nu; `normal`, når du svarer brugeren.

I ikke-brief-builds er kun `message` tilgængelig.

## Eksempler

### Eksempel 1: Proaktiv færdiggørelsesmeddelelse

```
SendUserMessage(
  message="The migration finished — 42 files updated, tests green.",
  status="proactive"
)
```

## Noter

- Kun aktiveret i brief-tilstand eller via den tilsvarende feature-udrulning; de fleste interaktive CLI-sessioner taler i stedet direkte til brugeren.
- Brug `proactive` sparsomt — det er beregnet til ting, der reelt har brug for brugerens opmærksomhed nu.
