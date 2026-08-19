# Zanieczyszczenie kontekstu w Translate API

## Kontekst

CC-Viewer zawiera wbudowaną funkcję tłumaczenia (`POST /api/translate`) opartą na Anthropic Messages API. We wczesnej implementacji żądania tłumaczenia ponownie wykorzystywały buforowane dane uwierzytelniające z sesji Claude Code — w tym zarówno nagłówki `x-api-key`, jak i `authorization`. Powodowało to subtelny, ale poważny problem: wyniki tłumaczeń często zwracały nieistotną treść.

## Przyczyna źródłowa

### Fundamentalna różnica między dwoma metodami uwierzytelniania

Anthropic API obsługuje dwie metody uwierzytelniania:

| Metoda | Nagłówek | Typowe źródło | Charakterystyka |
|--------|----------|---------------|-----------------|
| Klucz API | `x-api-key: sk-ant-...` | Zmienna środowiskowa / Console | Bezstanowy, każde żądanie jest niezależne |
| Token OAuth | `authorization: Bearer sessionToken` | Logowanie subskrypcyjne Claude Code | Powiązany z sesją, serwer utrzymuje powiązanie kontekstu |

Kluczowa różnica: **Klucze API są bezstanowe** — każde żądanie jest całkowicie niezależne; natomiast **tokeny sesji OAuth są stanowe** — serwer Anthropic wiąże żądania używające tego samego tokena z tym samym kontekstem sesji.

### Łańcuch zanieczyszczenia

Gdy Claude Code używa logowania subskrypcyjnego OAuth, przepływ uwierzytelniania wygląda następująco:

```
Główna rozmowa Claude Code ──(authorization: Bearer sessionToken)──→ Anthropic API
                                                                        ↑
Żądanie tłumaczenia CC-Viewer ──(authorization: Bearer sessionToken)──→ Anthropic API
```

Ponieważ żądania tłumaczenia ponownie wykorzystywały ten sam token sesji, serwer Anthropic może powiązać żądania tłumaczenia z kontekstem głównej rozmowy Claude Code. Powoduje to:

1. **Wyniki tłumaczenia pod wpływem kontekstu głównej rozmowy**: Prompt systemowy żądania tłumaczenia to „jesteś tłumaczem", ale kontekst serwera nadal zawiera historię rozmów Claude Code, co może zakłócać działanie modelu
2. **Główna rozmowa zakłócana przez żądania tłumaczenia**: Treść żądań tłumaczenia (fragmenty tekstu UI) może zostać wstrzyknięta do kontekstu głównej rozmowy, powodując odchylenia w odpowiedziach Claude Code
3. **Nieprzewidywalne zachowanie**: Ponieważ zanieczyszczenie kontekstu jest zachowaniem po stronie serwera, klient nie może go wykryć ani kontrolować

## Wnioski

- **Tokeny sesji OAuth to nie „po prostu kolejny klucz API"** — niosą ze sobą stan po stronie serwera, a ich ponowne użycie oznacza współdzielenie kontekstu
- **Wewnętrzne wywołania usług powinny używać niezależnego, bezstanowego uwierzytelniania**, aby uniknąć powiązania z sesjami użytkowników

## Odnośniki

- [Anthropic API Authentication Docs](https://docs.anthropic.com/en/api/getting-started)
- [Claude Code Authentication](https://support.claude.com/en/articles/12304248-managing-api-key-environment-variables-in-claude-code)
- [Anthropic Bans Subscription OAuth in Third-Party Apps](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)
- [Claude Code Authentication: API Keys, Subscriptions, and SSO](https://developertoolkit.ai/en/claude-code/quick-start/authentication/)
