# Artifact

Gjengir en HTML- eller Markdown-fil som et Artifact — en privat nettside hostet på claude.ai som brukeren kan åpne i en nettleser og senere velge å dele. Bruk det når visuell kommunikasjon er bedre enn terminaltekst.

## Når skal den brukes

- Publisering av et visuelt resultat: en rapport, instrumentbord, feilutredning eller UI-mockup
- Oppdatering av en tidligere publisert side på samme sted (samme filsti publiseres på nytt til samme URL)
- Viser brukerens eksisterende artifacts for å finne en fra en tidligere sesjon (`action: "list"`)
- **Ikke** for innhold som må holdes lokalt, for rene tekstsvar eller noe som krever eksterne nettverksressurser ved visning — et strikt CSP blokkerer alle eksterne verter

## Aktivering

- Krever en Pro-, Max-, Team- eller Enterprise-plan med claude.ai-innlogging (`/login`).
- Kun Anthropic API — ikke tilgjengelig på Amazon Bedrock, Google Cloud eller Microsoft Foundry.
- Krever Claude Code ≥ 2.1.183 eller Desktop-appen ≥ 1.13576.0.
- Deaktiver med innstillingen `disableArtifact` eller `CLAUDE_CODE_DISABLE_ARTIFACT=1`.

## Parametere

- `file_path` (streng): Sti til `.html`- eller `.md`-filen som skal gjengis. Filen omgis av et dokumentskjelett ved publisering, så skriv sidekontent direkte — ingen `<!DOCTYPE>`, `<html>`, `<head>` eller `<body>`-tagger. Samme sti → samme URL ved gjenblising; en annen sti gjør krav på en ny URL.
- `favicon` (streng, påkrevd for å publisere): Ett eller to emoji brukt som nettleserkortikon (f.eks. `"📊"`). Kun emoji, ingen markup. Behold det samme ved gjenblising — brukere finner fanen sin etter ikonet.
- `description` (streng): En-setnings undertittel vist på artifact-gallerikort.
- `url` (streng, valgfri): Send en eksisterende artifacts URL for å oppdatere den på samme sted fra en samtale som ikke publiserte den. Uten det minter en ny samtale alltid en ny URL.
- `label` (streng, valgfri): Kort menneskelesbar versjonsnavn (maks 60 tegn) vist i versjonsvelgeren.
- `action` (streng, valgfri): `"publish"` (standard) eller `"list"` — viser brukerens publiserte artifacts (tittel, URL, sist oppdatert), eventuelt med `limit`.
- `force` (boolsk, valgfri): Overskriv uten konfliktsjekk. Bare etter en 409 fra en samtidig skriving, når den er løst.

## Notater

- **Kun selvbeholdt innhold.** Et strikt CSP blokkerer forespørsler til enhver ekstern vert — CDN-skript, eksterne stilark, ekstern innhold, fetch/WebSockets. Sett inn all CSS/JS og integrer aktiva som `data:` URI-er.
- **Responsiv og temabevisst.** Sider gjengi i visningsverktøyets lys- eller mørkt tema; stil begge (`prefers-color-scheme` pluss visningsverktøyets `data-theme` overstyring). Bredt innhold ruller innenfor egen beholder — sidens hoveddel må aldri rulle vannrett.
- **Oppdatering på tvers av samtaler krever `url`.** Gjenblising av samme filsti bruker bare URL'en innenfor samtalen som publiserte den; for å bevare en eldre artifacts lenke må du finne URL'en med `action: "list"` og sende den som `url`.
- **Publisering er utadvendt.** Innhold sendt til artifact-tjenesten kan bli bufret selv om det slettes senere — ikke publiser noe som må holdes privat på maskinen.
- **Les tilbake med WebFetch.** claude.ai artifact-URL'er kan hentes via WebFetch (ikke curl, som får app-skallet).
