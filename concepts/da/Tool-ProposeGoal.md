# ProposeGoal

Foreslår et verificerbart færdiggørelsesmål for sessionen. Målet vises til brugeren i en godkendelsesdialog (som standard), og når det først er sat, styrer det resten af samtalen mod et kontrollerbart udfald.

## Hvornår skal den bruges

- Sessionen har en konkret sluttilstand, som en evaluator kunne verificere ud fra samtalen (f.eks. "all tests in test/auth pass").
- Du vil have brugerens eksplicitte godkendelse af, hvad "færdig" betyder, før du udfører betydeligt arbejde.
- Brugerens egne ord har allerede angivet udfaldet, og du vil have det registreret som sessionens mål.

## Parametre

- `condition` (string, påkrævet): Færdiggørelsesbetingelsen, skrevet så en separat evaluator kan verificere den ud fra samtalen (f.eks. "all tests in test/auth pass (bun test exits 0)"). Højst 500 tegn — brugeren skal kunne læse hele betingelsen i godkendelsesdialogen.
- `ask_user` (boolean, valgfri): Om brugeren skal spørges om godkendelse, før målet sættes. Standard er true (en godkendelsesdialog vises). Sæt kun false, NÅR brugerens egne ord i denne samtale angav dette udfald som det, de ønsker; målet sættes så direkte med en synlig meddelelse, og brugeren kan rydde det med `/goal clear`.

## Eksempler

### Eksempel 1: Foreslå et testforankret mål

```
ProposeGoal(condition="npm run test exits 0 with the new catalog cases included")
```

Brugeren ser betingelsen i en godkendelsesdialog og kan acceptere, redigere eller afvise den.

### Eksempel 2: Overtag brugerens angivne udfald direkte

```
ProposeGoal(condition="the login form validates email format and shows an inline error", ask_user=false)
```

Kun gyldigt, fordi brugeren eksplicit angav dette udfald tidligere i samtalen.

## Noter

- Hold `condition` kort og objektivt kontrollerbar — vage mål ("make it better") modarbejder formålet.
- `ask_user=false` er strengt begrænset til udfald, brugeren selv angav; alt andet skal gennem godkendelsesdialogen.
