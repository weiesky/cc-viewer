# Skill

Invokerer en navngivet skill inde i den aktuelle samtale. Skills er færdigpakkede kapacitetsbundter — domæneviden, workflows og nogle gange værktøjsadgang — som rammen eksponerer for assistenten gennem system-påmindelser.

## Hvornår skal den bruges

- Brugeren skriver en slash-kommando som `/review` eller `/init` — slash-kommandoer er skills og skal eksekveres gennem dette værktøj.
- Brugeren beskriver en opgave, der matcher en annonceret skills triggerbetingelser (for eksempel at bede om at scanne transkripter for gentagne tilladelsesforespørgsler matcher `fewer-permission-prompts`).
- En skills angivne formål matcher direkte den aktuelle fil, anmodning eller samtalekontekst.
- Specialiserede, gentagne workflows er tilgængelige som skills, og den kanoniske procedure er at foretrække frem for en ad hoc-tilgang.
- Brugeren spørger "hvilke skills er tilgængelige" — oplist de annoncerede navne, og invokér kun, når de bekræfter.

## Parametre

- `skill` (string, påkrævet): Det nøjagtige navn på en skill, der er listet i den aktuelle available-skills system-påmindelse. For plugin-navnerum-skills skal du bruge den fuldt kvalificerede `plugin:skill`-form (for eksempel `skill-creator:skill-creator`). Medtag ikke en indledende skråstreg.
- `args` (string, valgfri): Frit formulerede argumenter, der sendes til skillen. Format og semantik defineres af hver skills egen dokumentation.

## Eksempler

### Eksempel 1: Kør en review-skill på den aktuelle branch

```
Skill(skill="review")
```

`review`-skillen pakker trinnene til at gennemgå en pull request mod den aktuelle base-branch. Invokering indlæser den ramme-definerede reviewprocedure i runden.

### Eksempel 2: Invokér en plugin-navnerum-skill med argumenter

```
Skill(
  skill="skill-creator:skill-creator",
  args="create a skill that summarizes git log for a given date range"
)
```

Dirigerer anmodningen gennem `skill-creator`-plugin'ets indgangspunkt, så forfatterworkflowet starter.

## Noter

- Invokér kun skills, hvis navne fremgår ordret i available-skills system-påmindelsen, eller skills, brugeren skrev direkte som `/navn` i sin besked. Gæt eller opfind aldrig skill-navne fra hukommelse eller træningsdata — hvis skillen ikke er annonceret, kald ikke dette værktøj.
- Når en brugers anmodning matcher en annonceret skill, er kald af `Skill` en blokerende forudsætning: invokér den, før du genererer noget andet svar om opgaven. Beskriv ikke, hvad skillen ville gøre — kør den.
- Nævn aldrig en skill ved navn uden faktisk at invokere den. At annoncere en skill uden at kalde værktøjet er vildledende.
- Brug ikke `Skill` til indbyggede CLI-kommandoer som `/help`, `/clear`, `/model` eller `/exit`. De håndteres af rammen direkte.
- Invokér ikke en skill igen, som allerede kører i den aktuelle runde. Hvis du ser et `<command-name>`-tag i den aktuelle runde, er skillen allerede indlæst — følg dens instruktioner i stedet for at kalde værktøjet igen.
- Hvis flere skills kunne anvendes, vælg den mest specifikke. For konfigurationsændringer som at tilføje tilladelser eller hooks, foretræk `update-config` frem for en generisk indstillingstilgang.
- Skill-eksekvering kan introducere nye system-påmindelser, værktøjer eller begrænsninger for resten af runden. Genlæs samtaletilstanden, efter en skill er færdig, før du fortsætter.
