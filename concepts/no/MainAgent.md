# MainAgent

## Definisjon

MainAgent er hovedforespørselskjeden i Claude Code når den ikke er i agent team-modus. Hver interaksjon mellom brukeren og Claude Code produserer en serie API-forespørsler, der MainAgent-forespørslene utgjør den sentrale samtalekjeden — de bærer komplett system prompt, verktøydefinisjoner og meldingshistorikk.

## Identifisering

I cc-viewer identifiseres MainAgent gjennom `req.mainAgent === true`, som automatisk settes av `interceptor.js` ved forespørselsfangst.

Bestemmelsesvilkår (alle må oppfylles):
- Forespørselskroppen inneholder `system`-felt (system prompt)
- Forespørselskroppen inneholder `tools`-array (verktøydefinisjoner)
- System prompt inneholder "Claude Code"-kjennetekst

## Forskjell fra SubAgent

| Egenskap | MainAgent | SubAgent |
|----------|-----------|----------|
| system prompt | Komplett Claude Code hoved-prompt | Forenklet oppgavespesifikt prompt |
| tools-array | Inneholder alle tilgjengelige verktøy | Inneholder vanligvis bare verktøy som trengs for oppgaven |
| Meldingshistorikk | Akkumulerer full samtalekontekst | Inneholder bare meldinger relatert til deloppgaven |
| Cache-oppførsel | Har prompt caching (5 minutters TTL) | Vanligvis ingen cache eller liten cache |
