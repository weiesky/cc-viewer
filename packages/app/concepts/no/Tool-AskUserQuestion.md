# AskUserQuestion

Presenterer brukeren for ett eller flere strukturerte flervalgsspørsmål i chat-UI-et, samler inn valgene og returnerer dem til assistenten — nyttig for å avklare intensjon uten fritekst frem og tilbake.

## Når skal den brukes

- En forespørsel har flere rimelige tolkninger og assistenten trenger at brukeren velger én før den fortsetter.
- Brukeren må velge mellom konkrete alternativer (rammeverk, bibliotek, filbane, strategi) der fritekstsvar ville være feilutsatt.
- Du vil sammenligne alternativer side om side med forhåndsvisningsruten.
- Flere relaterte beslutninger kan samles i én ledetekst for å redusere frem og tilbake.
- En plan eller et verktøykall avhenger av konfigurasjon som brukeren ennå ikke har spesifisert.

## Parametere

- `questions` (array, påkrevd): Ett til fire spørsmål vist sammen i én ledetekst. Hvert spørsmålsobjekt inneholder:
  - `question` (string, påkrevd): Hele spørsmålsteksten, som slutter med spørsmålstegn.
  - `header` (string, påkrevd): En kort etikett (maksimalt 12 tegn) som vises som en chip over spørsmålet.
  - `options` (array, påkrevd): To til fire alternativobjekter. Hvert alternativ har en `label` (1–5 ord), en `description` og en valgfri `markdown`-forhåndsvisning.
  - `multiSelect` (boolean, påkrevd): Når `true` kan brukeren velge mer enn ett alternativ.

## Eksempler

### Eksempel 1: Velg ett rammeverk

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

### Eksempel 2: Side-ved-side forhåndsvisning av to layouter

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

## Notater

- UI-et legger automatisk til et fritekstalternativ "Other" for hvert spørsmål. Ikke legg til ditt eget "Other", "None" eller "Custom" — det vil duplisere den innebygde rømningsluken.
- Begrens hvert kall til mellom ett og fire spørsmål og hvert spørsmål til mellom to og fire alternativer. Å overskride disse grensene avvises av rammeverket.
- Hvis du anbefaler et bestemt alternativ, plasser det først og legg til "(Recommended)" i etiketten slik at UI-et fremhever den foretrukne veien.
- Forhåndsvisninger via `markdown`-feltet støttes kun for enkeltvalgsspørsmål. Bruk dem for visuelle artefakter som ASCII-layouter, kodesnutter eller konfigurasjonsdiffer — ikke for enkle preferansespørsmål der etikett pluss beskrivelse er nok.
- Når et alternativ i et spørsmål har en `markdown`-verdi, bytter UI-et til en side-ved-side-layout med alternativlisten til venstre og forhåndsvisningen til høyre.
- Ikke bruk `AskUserQuestion` for å spørre "ser denne planen bra ut?" — kall `ExitPlanMode` i stedet, som finnes nettopp for plangodkjenning. I planmodus bør du også unngå å nevne "planen" i spørsmålstekst, fordi planen ikke er synlig for brukeren før `ExitPlanMode` kjører.
- Ikke bruk dette verktøyet for å be om sensitive eller fritekstinput som API-nøkler eller passord. Spør i chatten i stedet.
