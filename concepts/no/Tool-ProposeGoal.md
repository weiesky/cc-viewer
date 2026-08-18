# ProposeGoal

Foreslår et verifiserbart fullføringsmål for sesjonen. Målet vises til brukeren i en godkjenningsdialog (som standard) og styrer, når det er satt, resten av samtalen mot et kontrollerbart utfall.

## Når skal den brukes

- Sesjonen har en konkret sluttilstand som en evaluator kunne verifisere ut fra samtalen (f.eks. "alle tester i test/auth passerer").
- Du vil ha brukerens eksplisitte godkjenning av hva "ferdig" betyr før du gjør betydelig arbeid.
- Brukerens egne ord allerede har uttalt utfallet, og du vil at det skal registreres som sesjonens mål.

## Aktivering

- Av som standard (server-side feature-flag).
- Ekskludert fra interaktive og bakgrunnssesjoner.
- Skrudd av av innstillingsnøkkelen `modelProposedGoals: "disabled"`.

## Parametere

- `condition` (string, påkrevd): Fullføringsbetingelsen, skrevet slik at en separat evaluator kan verifisere den ut fra samtalen (f.eks. "alle tester i test/auth passerer (bun test går ut med 0)"). Maks 500 tegn — brukeren må kunne lese hele betingelsen i godkjenningsdialogen.
- `ask_user` (boolean, valgfri): Om brukeren skal spørres om godkjenning før målet settes. Standard er true (en godkjenningsdialog vises). Sett false KUN når brukerens egne ord i denne samtalen har uttalt dette utfallet som det de ønsker; målet settes da direkte med en synlig merknad, og brukeren kan fjerne det med `/goal clear`.

## Eksempler

### Eksempel 1: Foreslå et testbasert mål

```
ProposeGoal(condition="npm run test exits 0 with the new catalog cases included")
```

Brukeren ser betingelsen i en godkjenningsdialog og kan godta, redigere eller avvise den.

### Eksempel 2: Adopter brukerens uttalte utfall direkte

```
ProposeGoal(condition="the login form validates email format and shows an inline error", ask_user=false)
```

Kun gyldig fordi brukeren eksplisitt uttalte det utfallet tidligere i samtalen.

## Notater

- Hold `condition` kort og objektivt kontrollerbar — vage mål ("gjør det bedre") motarbeider formålet.
- `ask_user=false` er strengt begrenset til utfall brukeren selv uttalte; alt annet må gå gjennom godkjenningsdialogen.
