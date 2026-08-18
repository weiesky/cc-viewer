# ListSkills

Elenca le skill claude.ai abilitate dell'utente, opzionalmente filtrate per parola chiave.

## Quando usare

- Hai bisogno dell'elenco autorevole delle skill attualmente abilitate — prima di invocarne una, o per confermare cosa ha aggiunto una scheda di `SuggestSkills`.
- L'utente chiede quali skill ha.

## Parametri

- `keywords` (array of strings, opzionale): Filtra l'elenco — fino a 8 elementi, ciascuno di 1–64 caratteri. Ometti per elencare tutto.

## Esempi

### Esempio 1: Elencare le skill abilitate

```
ListSkills()
```

### Esempio 2: Filtrare per parola chiave

```
ListSkills(keywords=["review"])
```

## Note

- Se il catalogo è irraggiungibile (forbidden), il tool degrada a un elenco vuoto con un avviso invece di fallire.
- Questo elenca le skill *abilitate*; usa `SuggestSkills` per far emergere skill che l'utente potrebbe aggiungere.
