# ListPlugins

Elenca i plugin claude.ai abilitati dell'utente, opzionalmente filtrati per parola chiave.

## Quando usare

- Devi sapere quali plugin sono già abilitati — ad esempio, per confermare cosa è stato installato dopo una scheda di `SuggestPluginInstall`.
- L'utente chiede quali plugin ha.

## Parametri

- `keywords` (array of strings, opzionale): Filtra l'elenco — fino a 8 elementi, ciascuno di 1–64 caratteri. Ometti per elencare tutto.

## Esempi

### Esempio 1: Elencare i plugin abilitati

```
ListPlugins()
```

### Esempio 2: Filtrare per parola chiave

```
ListPlugins(keywords=["figma"])
```

## Note

- Se il catalogo dei plugin è irraggiungibile (forbidden), il tool degrada a un elenco vuoto con un avviso invece di fallire.
- La disponibilità dipende dal tipo di sessione e dal feature rollout.
