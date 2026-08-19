# SendUserFile

Invia uno o più file all'utente — artefatti generati, screenshot, report — con controllo su come il client li presenta.

## Quando usare

- Hai prodotto un file di cui l'utente ha bisogno (un report, un'immagine, una pagina HTML) e vuoi farlo emergere, non solo menzionarne il percorso.
- Rispondere con un allegato (`status="normal"`), oppure far emergere proattivamente qualcosa che l'utente non ha chiesto ma deve vedere ora (`status="proactive"`).

## Attivazione

- Disponibile solo quando un client Remote Control è connesso, o la sessione gira in un ambiente cloud gestito (ad esempio Claude Code sul web).
- Non disponibile su Amazon Bedrock, Google Cloud o Microsoft Foundry.
- Richiede che la sessione consenta l'invio di file (una capacità gated da impostazioni/feature); non offerta in brief mode.

## Parametri

- `files` (array of strings, obbligatorio): Percorsi di file (assoluti o relativi alla cwd) da inviare all'utente. Passa sempre un array, anche per un singolo file.
- `caption` (string, opzionale): Breve didascalia per i file.
- `status` (string, obbligatorio): `proactive` quando fai emergere un file che l'utente non ha chiesto e deve vedere ora — un artefatto generato, un report completato; `normal` quando rispondi a qualcosa che l'utente ha appena detto.
- `display` (string, opzionale): `render` apre il file inline nel pannello laterale (HTML, SVG, Mermaid, immagini, PDF); `attach` mostra solo una scheda di download (deliverable che l'utente salverà e aprirà altrove). Ometti per lasciare decidere al client in base al tipo di file.

## Esempi

### Esempio 1: Consegnare un report generato

```
SendUserFile(
  files=["./out/weekly-report.html"],
  caption="Weekly usage report",
  status="proactive",
  display="render"
)
```

## Note

- Scegli `display="attach"` per file che l'utente salva e apre in un'altra app; `render` per qualsiasi cosa debba guardare immediatamente.
