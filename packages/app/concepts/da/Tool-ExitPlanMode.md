# ExitPlanMode

Indsender implementeringsplanen, der blev udarbejdet under plantilstand, til brugergodkendelse og — hvis godkendt — skifter sessionen ud af plantilstand, så redigeringer kan begynde.

## Hvornår skal den bruges

- En plan, der blev skrevet under `EnterPlanMode`, er færdig og klar til gennemgang.
- Opgaven er implementeringsfokuseret (kode- eller konfigurationsændringer), ikke ren research, så en eksplicit plan er passende.
- Al forudgående læsning og analyse er udført; ingen yderligere undersøgelse er nødvendig, før brugeren beslutter sig.
- Assistenten har opregnet konkrete filstier, funktioner og trin — ikke blot mål.
- Brugeren har bedt om at se planen, eller plantilstand-workflowet er ved at overdrage til redigeringsværktøjer.

## Parametre

- `allowedPrompts` (array, valgfri): Forespørgsler, som brugeren må skrive på godkendelsesskærmen for at auto-godkende eller ændre planen. Hvert element angiver en afgrænset tilladelse (for eksempel et operationsnavn og det værktøj, det gælder for). Lad være med at sætte for at bruge standardgodkendelsesflowet.

## Eksempler

### Eksempel 1: Standardindsendelse

Efter at have undersøgt en godkendelsesrefaktorering inde i plantilstand og skrevet planfilen til disk, kalder assistenten `ExitPlanMode` uden argumenter. Rammen læser planen fra dens kanoniske placering, viser den til brugeren og venter på godkendelse eller afvisning.

### Eksempel 2: Forhåndsgodkendte hurtighandlinger

```
ExitPlanMode(allowedPrompts=[
  {"tool": "Bash", "prompt": "run tests"},
  {"tool": "Bash", "prompt": "install dependencies"}
])
```

Lader brugeren give tilladelse på forhånd til rutinemæssige opfølgningskommandoer, så assistenten ikke behøver at pause ved hver tilladelsesforespørgsel under implementeringen.

## Noter

- `ExitPlanMode` giver kun mening for implementeringslignende arbejde. Hvis brugerens anmodning er en research- eller forklaringsopgave uden filændringer, svar direkte i stedet — dirigér ikke gennem plantilstand blot for at afslutte den.
- Planen skal allerede være skrevet til disk, før dette værktøj kaldes. `ExitPlanMode` accepterer ikke planteksten som en parameter; den læser fra den sti, rammen forventer.
- Hvis brugeren afviser planen, vender du tilbage til plantilstand. Revidér ud fra feedbacken og indsend igen; begynd ikke at redigere filer, mens planen er ugodkendt.
- Godkendelse giver tilladelse til at forlade plantilstand og bruge muterende værktøjer (`Edit`, `Write`, `Bash` og så videre) inden for det omfang, der er beskrevet i planen. Udvidelse af omfang bagefter kræver en ny plan eller eksplicit brugersamtykke.
- Brug ikke `AskUserQuestion` til at spørge "ser denne plan god ud?", før dette værktøj kaldes — at anmode om plangodkendelse er præcis, hvad `ExitPlanMode` gør, og brugeren kan ikke se planen, før den er indsendt.
- Hold planen minimal og handlingsorienteret. En anmelder bør kunne skimme den på under et minut og forstå præcis, hvad der vil ændre sig.
- Hvis du midt i implementeringen indser, at planen var forkert, stop og rapportér tilbage til brugeren i stedet for stille at afvige. At gå i plantilstand igen er et gyldigt næste skridt.
