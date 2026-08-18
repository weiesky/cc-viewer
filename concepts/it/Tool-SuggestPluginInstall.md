# SuggestPluginInstall

Mostra una scheda inline di installazione di plugin dai risultati di `SearchPlugins`, collegando i suggerimenti di plugin alla richiesta dell'utente.

## Quando usare

- Una ricerca di plugin ha fatto emergere plugin che corrispondono a ciò che l'utente sta cercando di fare, e vuoi offrirli per l'installazione.

## Parametri

- `contextLabel` (string, obbligatorio): Intestazione breve che collega il suggerimento alla richiesta dell'utente (massimo 128 caratteri).
- `plugins` (array, obbligatorio): Plugin provenienti dai risultati di `SearchPlugins` — 1–16 voci, ciascuna con:
  - `pluginId` (string, obbligatorio)
  - `pluginName` (string, obbligatorio)
  - `description` (string, obbligatorio)
  - `skills` (array, opzionale): Fino a 32 voci `{name, description?}` che descrivono le skill del plugin.

## Esempi

### Esempio 1: Offrire un plugin corrispondente

```
SuggestPluginInstall(
  contextLabel="For reviewing pull requests",
  plugins=[{pluginId="pr-toolkit", pluginName="PR Toolkit", description="Review helpers"}]
)
```

La scheda viene mostrata all'utente; l'abilitazione del plugin avviene fuori banda. Chiama `ListPlugins` in seguito per scoprire cosa è stato effettivamente installato.

## Note

- Includi solo plugin provenienti dai risultati di ricerca — non inventare mai voci di plugin.
- Disabilitato nelle configurazioni enterprise HIPAA.
