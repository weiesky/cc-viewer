# SuggestSkills

Mostra una scheda di skill autonome che l'utente può aggiungere (skill non ancora abilitate), in base a parole chiave sull'argomento.

## Quando usare

- La richiesta dell'utente corrisponde a skill che non ha abilitate (`trigger="user_asked"` quando le ha chieste, `trigger="proactive"` quando suggerisci senza che siano state richieste).

## Attivazione

- Solo quando un client Remote Control è connesso, o la sessione gira in un ambiente cloud gestito.
- Disabilitato nelle configurazioni enterprise HIPAA.
- Non in brief mode.

## Parametri

- `keywords` (array of strings, obbligatorio): Parole chiave sull'argomento tratte dalla richiesta dell'utente. 1–8 elementi, ciascuno di 1–64 caratteri.
- `contextLabel` (string, opzionale): Etichetta breve che collega il suggerimento alla richiesta (massimo 128 caratteri).
- `trigger` (string, opzionale): Come è iniziato questo suggerimento — `user_asked` oppure `proactive`.

## Esempi

### Esempio 1: Suggerire skill per argomento

```
SuggestSkills(keywords=["data visualization", "charts"], contextLabel="For building the dashboard", trigger="user_asked")
```

Le skill già abilitate vengono filtrate dal risultato.

## Note

- Mostra solo una scheda di suggerimento — l'aggiunta di una skill avviene fuori banda; chiama `ListSkills` in seguito per confermare.
