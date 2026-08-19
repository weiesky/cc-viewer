# ProposeGoal

Propone un obiettivo di completamento verificabile per la sessione. L'obiettivo viene mostrato all'utente in un dialogo di approvazione (di default) e, una volta impostato, guida il resto della conversazione verso un esito verificabile.

## Quando usare

- La sessione ha uno stato finale concreto che un valutatore potrebbe verificare dalla conversazione (ad esempio "all tests in test/auth pass").
- Vuoi un'esplicita approvazione dell'utente su cosa significhi "fatto" prima di svolgere un lavoro sostanziale.
- Le parole stesse dell'utente hanno già dichiarato l'esito e vuoi registrarlo come obiettivo della sessione.

## Attivazione

- Disattivato per default (feature flag lato server).
- Escluso dalle sessioni interattive e in background.
- Disattivato dalla chiave di impostazione `modelProposedGoals: "disabled"`.

## Parametri

- `condition` (string, obbligatorio): La condizione di completamento, scritta in modo che un valutatore separato possa verificarla dalla conversazione (ad esempio "all tests in test/auth pass (bun test exits 0)"). Al massimo 500 caratteri — l'utente deve poter leggere l'intera condizione nel dialogo di approvazione.
- `ask_user` (boolean, opzionale): Se chiedere l'approvazione all'utente prima che l'obiettivo venga impostato. Default: true (viene mostrato un dialogo di approvazione). Imposta false SOLO quando le parole stesse dell'utente in questa conversazione hanno dichiarato questo esito come ciò che vuole; l'obiettivo viene quindi impostato direttamente con un avviso visibile, e l'utente può cancellarlo con `/goal clear`.

## Esempi

### Esempio 1: Proporre un obiettivo fondato sui test

```
ProposeGoal(condition="npm run test exits 0 with the new catalog cases included")
```

L'utente vede la condizione in un dialogo di approvazione e può accettarla, modificarla o rifiutarla.

### Esempio 2: Adottare direttamente l'esito dichiarato dall'utente

```
ProposeGoal(condition="the login form validates email format and shows an inline error", ask_user=false)
```

Valido solo perché l'utente ha dichiarato esplicitamente quell'esito in precedenza nella conversazione.

## Note

- Mantieni `condition` breve e oggettivamente verificabile — obiettivi vaghi ("make it better") vanificano lo scopo.
- `ask_user=false` è strettamente limitato agli esiti che l'utente stesso ha dichiarato; qualsiasi altra cosa deve passare dal dialogo di approvazione.
