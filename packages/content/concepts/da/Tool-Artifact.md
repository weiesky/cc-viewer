# Artifact

Render en HTML- eller Markdown-fil til et Artifact — en privat webside hostet på claude.ai, som brugeren kan åbne i en browser og senere vælge at dele. Brug det, når visuel kommunikation er bedre end terminaltekst.

## Hvornår skal den bruges

- Publicering af en visuelt resultat: en rapport, dashboard, fejlundersøgelsesnotat eller UI-mockup
- Opdatering af en tidligere publiceret side på samme sted (samme filsti udsender igen til samme URL)
- Lister over brugerens eksisterende artifacts for at finde en fra en tidligere session (`action: "list"`)
- **Ikke** til indhold, der skal være lokalt, til rene tekstsvar eller noget, der kræver eksterne netværksressourcer ved visning — en streng CSP blokerer alle eksterne værter

## Aktivering

- Kræver et Pro-, Max-, Team- eller Enterprise-abonnement med claude.ai-login (`/login`).
- Kun Anthropic API — ikke tilgængelig på Amazon Bedrock, Google Cloud eller Microsoft Foundry.
- Kræver Claude Code ≥ 2.1.183 eller Desktop-appen ≥ 1.13576.0.
- Deaktivér med settings-indstillingen `disableArtifact` eller `CLAUDE_CODE_DISABLE_ARTIFACT=1`.

## Parametre

- `file_path` (streng): Sti til den `.html`- eller `.md`-fil, der skal renderes. Filen omgives af en dokumentstruktur ved publicering, så skriv sideindhold direkte — ingen `<!DOCTYPE>`, `<html>`, `<head>` eller `<body>`-tags. Samme sti → samme URL ved genudsendelse; en anden sti gør krav på en ny URL.
- `favicon` (streng, påkrævet for at publicere): Et eller to emoji, der bruges som browserkortikonet (f.eks. `"📊"`). Kun emoji, ingen markup. Behold det samme ved genudsendelse — brugere finder deres fane efter ikonet.
- `description` (streng): En-sætnings undertitel vist på artifact galleriet-kort.
- `url` (streng, valgfri): Giv en eksisterende artifacts URL for at opdatere den på samme sted fra en samtale, der ikke publicerede den. Uden det minter en ny samtale altid en ny URL.
- `label` (streng, valgfri): Kort menneskeligt læsbar versionsnavn (maks 60 tegn) vist i versionsvælgeren.
- `action` (streng, valgfri): `"publish"` (standard) eller `"list"` — opnumerer brugerens publicerede artifacts (titel, URL, sidst opdateret), eventuelt med `limit`.
- `force` (boolsk, valgfri): Overskriv uden konfliktcheck. Kun efter en 409 fra et samtidigt skriveforsøg, når det er løst.

## Noter

- **Kun selvstændigt indhold.** En streng CSP blokerer anmodninger til enhver ekstern vært — CDN-scripts, eksterne stylesheets, fjernbilleder, fetch/WebSockets. Indsæt alt CSS/JS og integrer aktiver som `data:` URI'er.
- **Responsiv og temabevidst.** Sider renderes i visningsværktøjets lys- eller mørketilstand; stil begge (`prefers-color-scheme` plus visningsværktøjets `data-theme` override). Bredt indhold ruller inden for sin egen container — sidens brødtekst må aldrig rulle vandret.
- **Opdatering på tværs af samtaler kræver `url`.** Genudsendelse af samme filsti genbruger kun URL'en inden for den samtale, der publicerede den; for at bevare et ældre artifacts link skal du finde dets URL med `action: "list"` og sende den som `url`.
- **Publicering er udadvendt.** Indhold, der sendes til artifact-tjenesten, kan blive cachelagret, selv hvis det slettes senere — publicer ikke noget, der skal være privat på maskinen.
- **Læs tilbage med WebFetch.** claude.ai artifact-URL'er kan hentes via WebFetch (ikke curl, som får app shell'en).
