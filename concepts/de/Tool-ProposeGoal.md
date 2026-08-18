# ProposeGoal

Schlägt ein überprüfbares Abschlussziel für die Sitzung vor. Das Ziel wird dem Benutzer (standardmäßig) in einem Freigabedialog angezeigt und leitet, sobald gesetzt, den Rest der Unterhaltung zu einem überprüfbaren Ergebnis.

## Wann verwenden

- Die Sitzung hat einen konkreten Endzustand, den ein Prüfer aus der Unterhaltung verifizieren könnte (z. B. "all tests in test/auth pass").
- Sie möchten die ausdrückliche Freigabe des Benutzers darüber, was "fertig" bedeutet, bevor Sie umfangreiche Arbeit leisten.
- Die eigenen Worte des Benutzers haben das Ergebnis bereits benannt, und Sie möchten es als Sitzungsziel festhalten.

## Parameter

- `condition` (string, erforderlich): Die Abschlussbedingung, so formuliert, dass ein separater Prüfer sie aus der Unterhaltung verifizieren kann (z. B. "all tests in test/auth pass (bun test exits 0)"). Höchstens 500 Zeichen – der Benutzer muss die gesamte Bedingung im Freigabedialog lesen können.
- `ask_user` (boolean, optional): Ob der Benutzer um Freigabe gebeten werden soll, bevor das Ziel gesetzt wird. Standard ist true (ein Freigabedialog wird angezeigt). Nur dann auf false setzen, wenn die eigenen Worte des Benutzers in dieser Unterhaltung genau dieses Ergebnis als das Gewünschte benannt haben; das Ziel wird dann direkt mit einem sichtbaren Hinweis gesetzt, und der Benutzer kann es mit `/goal clear` löschen.

## Beispiele

### Beispiel 1: Ein testgestütztes Ziel vorschlagen

```
ProposeGoal(condition="npm run test exits 0 with the new catalog cases included")
```

Der Benutzer sieht die Bedingung in einem Freigabedialog und kann sie annehmen, bearbeiten oder ablehnen.

### Beispiel 2: Das vom Benutzer genannte Ergebnis direkt übernehmen

```
ProposeGoal(condition="the login form validates email format and shows an inline error", ask_user=false)
```

Nur gültig, weil der Benutzer dieses Ergebnis zuvor in der Unterhaltung ausdrücklich genannt hat.

## Hinweise

- Halten Sie `condition` kurz und objektiv überprüfbar – vage Ziele ("make it better") verfehlen den Zweck.
- `ask_user=false` ist strikt auf Ergebnisse beschränkt, die der Benutzer selbst genannt hat; alles andere muss durch den Freigabedialog laufen.
