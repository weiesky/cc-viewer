# Kontekstforurening i Translate API

## Baggrund

CC-Viewer inkluderer en indbygget oversættelsesfunktion (`POST /api/translate`) drevet af Anthropic Messages API. I den tidlige implementering genbrugte oversættelsesanmodninger cachede autentificeringsoplysninger fra Claude Code-sessionen — herunder både `x-api-key` og `authorization` headers. Dette forårsagede et subtilt men alvorligt problem: oversættelsesresultater returnerede ofte irrelevant indhold.

## Grundårsag

### Fundamental forskel mellem to autentificeringsmetoder

Anthropic API understøtter to autentificeringsmetoder:

| Metode | Header | Typisk kilde | Karakteristika |
|--------|--------|--------------|----------------|
| API-nøgle | `x-api-key: sk-ant-...` | Miljøvariabel / Console | Tilstandsløs, hver anmodning er uafhængig |
| OAuth-token | `authorization: Bearer sessionToken` | Claude Code abonnementslogin | Sessionsbundet, serveren opretholder konteksttilknytning |

Den afgørende forskel: **API-nøgler er tilstandsløse** — hver anmodning er fuldstændig uafhængig; mens **OAuth-sessionstokens er tilstandsbaserede** — Anthropic-serveren tilknytter anmodninger med samme token til den samme sessionskontekst.

### Forureningskæde

Når Claude Code bruger OAuth-abonnementslogin, ser autentificeringsflowet sådan ud:

```
Claude Code hovedsamtale ──(authorization: Bearer sessionToken)──→ Anthropic API
                                                                      ↑
CC-Viewer oversættelsesanmodning ──(authorization: Bearer sessionToken)──→ Anthropic API
```

Da oversættelsesanmodninger genbrugte det samme sessionstoken, kan Anthropic-serveren tilknytte oversættelsesanmodninger til Claude Codes hovedsamtalekontekst. Dette medfører:

1. **Oversættelsesresultater påvirket af hovedsamtalens kontekst**: Oversættelsesanmodningens systemprompt er "du er en oversætter", men serverkonteksten indeholder stadig Claude Codes samtalehistorik, som potentielt kan forstyrre modellen
2. **Hovedsamtalen forstyrret af oversættelsesanmodninger**: Indhold fra oversættelsesanmodninger (UI-tekstfragmenter) kan blive injiceret i hovedsamtalens kontekst, hvilket får Claude Codes svar til at afvige
3. **Uforudsigelig adfærd**: Da kontekstforurening er serverside-adfærd, kan klienten ikke opdage eller kontrollere det

## Erfaringer

- **OAuth-sessionstokens er ikke "bare en anden API-nøgle"** — de bærer serverside-tilstand, og genbrug af dem betyder deling af kontekst
- **Interne servicekald bør bruge uafhængig, tilstandsløs autentificering** for at undgå tilknytning til brugersessioner

## Referencer

- [Anthropic API Authentication Docs](https://docs.anthropic.com/en/api/getting-started)
- [Claude Code Authentication](https://support.claude.com/en/articles/12304248-managing-api-key-environment-variables-in-claude-code)
- [Anthropic Bans Subscription OAuth in Third-Party Apps](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)
- [Claude Code Authentication: API Keys, Subscriptions, and SSO](https://developertoolkit.ai/en/claude-code/quick-start/authentication/)
