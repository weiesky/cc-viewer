# MainAgent

## Definition

MainAgent er den primære requestkæde i Claude Code, når det ikke er i agent team-tilstand. Hver interaktion mellem brugeren og Claude Code genererer en serie API-requests, hvor MainAgent-requests udgør den centrale samtalekæde — de bærer det komplette system prompt, værktøjsdefinitioner og beskedhistorik.

## Identifikationsmetode

I cc-viewer identificeres MainAgent via `req.mainAgent === true`, automatisk markeret af `interceptor.js` ved request-opfangning.

Betingelser for bestemmelse (alle skal være opfyldt):
- Request body indeholder feltet `system` (system prompt)
- Request body indeholder `tools`-arrayet (værktøjsdefinitioner)
- System prompten indeholder den karakteristiske tekst "Claude Code"

## Forskelle fra SubAgent

| Egenskab | MainAgent | SubAgent |
|------|-----------|----------|
| system prompt | Komplet Claude Code hoved-prompt | Forenklet opgavespecifikt prompt |
| tools-array | Indeholder alle tilgængelige værktøjer | Indeholder normalt kun de få værktøjer, der er nødvendige for opgaven |
| Beskedhistorik | Akkumulerer komplet samtale-kontekst | Indeholder kun beskeder relateret til underopgaven |
| Cache-adfærd | Har prompt caching (5 minutters TTL) | Normalt ingen cache eller mindre cache |
