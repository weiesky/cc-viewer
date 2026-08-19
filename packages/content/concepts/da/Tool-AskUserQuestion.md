# AskUserQuestion

Præsenterer brugeren for et eller flere strukturerede multiple choice-spørgsmål i chat-grænsefladen, indsamler deres valg og returnerer dem til assistenten — nyttigt til at afklare intentioner uden frit formuleret frem og tilbage.

## Hvornår skal den bruges

- En anmodning har flere rimelige fortolkninger, og assistenten skal have brugeren til at vælge en, før der fortsættes.
- Brugeren skal vælge mellem konkrete muligheder (framework, bibliotek, filsti, strategi), hvor fritekstsvar ville være fejlbehæftede.
- Du vil sammenligne alternativer side om side ved hjælp af forhåndsvisningsruden.
- Flere relaterede beslutninger kan batches til en enkelt forespørgsel for at reducere frem og tilbage.
- En plan eller et værktøjskald afhænger af konfiguration, som brugeren endnu ikke har angivet.

## Parametre

- `questions` (array, påkrævet): Et til fire spørgsmål vist sammen i en enkelt forespørgsel. Hvert spørgsmålsobjekt indeholder:
  - `question` (string, påkrævet): Den fulde spørgsmålstekst, der slutter med et spørgsmålstegn.
  - `header` (string, påkrævet): En kort label (højst 12 tegn), der vises som et mærke over spørgsmålet.
  - `options` (array, påkrævet): To til fire mulighedsobjekter. Hver mulighed har en `label` (1-5 ord), en `description` og en valgfri `markdown`-forhåndsvisning.
  - `multiSelect` (boolean, påkrævet): Når `true`, kan brugeren vælge mere end én mulighed.

## Eksempler

### Eksempel 1: Vælg et enkelt framework

```
AskUserQuestion(questions=[{
  "header": "Test runner",
  "question": "Which test runner should I configure?",
  "multiSelect": false,
  "options": [
    {"label": "Vitest (Recommended)", "description": "Fast, Vite-native, Jest-compatible API"},
    {"label": "Jest",                  "description": "Mature, broadest plugin ecosystem"},
    {"label": "Node --test",           "description": "Zero dependencies, built in"}
  ]
}])
```

### Eksempel 2: Side om side-forhåndsvisning af to layouts

```
AskUserQuestion(questions=[{
  "header": "Layout",
  "question": "Which dashboard layout do you prefer?",
  "multiSelect": false,
  "options": [
    {"label": "Sidebar",  "description": "Nav on the left", "markdown": "```\n+------+---------+\n| NAV  | CONTENT |\n+------+---------+\n```"},
    {"label": "Top bar",  "description": "Nav across top",  "markdown": "```\n+-----------------+\n|       NAV       |\n+-----------------+\n|     CONTENT     |\n+-----------------+\n```"}
  ]
}])
```

## Noter

- UI tilføjer automatisk en "Other"-fritekstindstilling til hvert spørgsmål. Tilføj ikke din egen "Other", "None" eller "Custom"-post — det vil duplikere den indbyggede nødudgang.
- Begræns hvert kald til mellem et og fire spørgsmål og hvert spørgsmål til mellem to og fire muligheder. Overskridelse af disse grænser afvises af rammen.
- Hvis du anbefaler en specifik mulighed, sæt den først og tilføj "(Recommended)" til dens label, så UI fremhæver den foretrukne sti.
- Forhåndsvisninger via `markdown`-feltet understøttes kun på single-select-spørgsmål. Brug dem til visuelle artefakter som ASCII-layouts, kodestumper eller konfigurationsdiffs — ikke til simple præferencespørgsmål, hvor en label plus beskrivelse er tilstrækkelig.
- Når en vilkårlig mulighed i et spørgsmål har en `markdown`-værdi, skifter UI til et side om side-layout med mulighedslisten til venstre og forhåndsvisningen til højre.
- Brug ikke `AskUserQuestion` til at spørge "ser denne plan god ud?" — kald i stedet `ExitPlanMode`, som netop findes til plangodkendelse. I plantilstand bør du også undgå at nævne "planen" i spørgsmålsteksten, fordi planen ikke er synlig for brugeren, før `ExitPlanMode` kører.
- Brug ikke dette værktøj til at anmode om følsomt eller fritformuleret input som API-nøgler eller adgangskoder. Spørg i stedet i chatten.
