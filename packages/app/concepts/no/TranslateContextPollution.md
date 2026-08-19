# Kontekstforurensning i Translate API

## Bakgrunn

CC-Viewer inkluderer en innebygd oversettelsesfunksjon (`POST /api/translate`) drevet av Anthropic Messages API. I den tidlige implementeringen gjenbrukte oversettelsesforespørsler bufrede autentiseringsopplysninger fra Claude Code-sesjonen — inkludert både `x-api-key`- og `authorization`-headere. Dette forårsaket et subtilt, men alvorlig problem: oversettelsesresultater returnerte ofte irrelevant innhold.

## Rotårsak

### Fundamental forskjell mellom to autentiseringsmetoder

Anthropic API støtter to autentiseringsmetoder:

| Metode | Header | Typisk kilde | Egenskaper |
|--------|--------|--------------|------------|
| API-nøkkel | `x-api-key: sk-ant-...` | Miljøvariabel / Console | Tilstandsløs, hver forespørsel er uavhengig |
| OAuth-token | `authorization: Bearer sessionToken` | Claude Code abonnementsinnlogging | Sesjonsbundet, serveren opprettholder konteksttilknytning |

Den avgjørende forskjellen: **API-nøkler er tilstandsløse** — hver forespørsel er fullstendig uavhengig; mens **OAuth-sesjonstokens er tilstandsbaserte** — Anthropic-serveren knytter forespørsler med samme token til samme sesjonskontekst.

### Forurensningskjede

Når Claude Code bruker OAuth-abonnementsinnlogging, ser autentiseringsflyten slik ut:

```
Claude Code hovedsamtale ──(authorization: Bearer sessionToken)──→ Anthropic API
                                                                      ↑
CC-Viewer oversettelsesforespørsel ──(authorization: Bearer sessionToken)──→ Anthropic API
```

Siden oversettelsesforespørsler gjenbrukte det samme sesjonstokenet, kan Anthropic-serveren knytte oversettelsesforespørsler til Claude Codes hovedsamtalekontekst. Dette fører til:

1. **Oversettelsesresultater påvirket av hovedsamtalens kontekst**: Oversettelsesforespørselens systemprompt er «du er en oversetter», men serverkonteksten inneholder fortsatt Claude Codes samtalehistorikk, som potensielt kan forstyrre modellen
2. **Hovedsamtalen forstyrret av oversettelsesforespørsler**: Innhold fra oversettelsesforespørsler (UI-tekstfragmenter) kan bli injisert i hovedsamtalens kontekst, noe som får Claude Codes svar til å avvike
3. **Uforutsigbar oppførsel**: Siden kontekstforurensning er oppførsel på serversiden, kan klienten ikke oppdage eller kontrollere det

## Erfaringer

- **OAuth-sesjonstokens er ikke «bare en annen API-nøkkel»** — de bærer tilstand på serversiden, og gjenbruk av dem betyr deling av kontekst
- **Interne tjenestekall bør bruke uavhengig, tilstandsløs autentisering** for å unngå tilknytning til brukersesjoner

## Referanser

- [Anthropic API Authentication Docs](https://docs.anthropic.com/en/api/getting-started)
- [Claude Code Authentication](https://support.claude.com/en/articles/12304248-managing-api-key-environment-variables-in-claude-code)
- [Anthropic Bans Subscription OAuth in Third-Party Apps](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)
- [Claude Code Authentication: API Keys, Subscriptions, and SSO](https://developertoolkit.ai/en/claude-code/quick-start/authentication/)
