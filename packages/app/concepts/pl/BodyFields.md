# Opis pol Request Body

Opis pol najwyzszego poziomu w request body Claude API `/v1/messages`.

## Lista pol

| Pole | Typ | Opis |
|------|------|------|
| **model** | string | Nazwa uzytego modelu, np. `claude-opus-4-6`, `claude-sonnet-4-6` |
| **messages** | array | Historia wiadomosci w konwersacji. Kazda wiadomosc zawiera `role` (user/assistant) i `content` (tablica blokow: tekst, obrazy, tool_use, tool_result itp.) |
| **system** | array | System prompt. Zawiera glowne instrukcje Claude Code, wskazowki dotyczace uzycia narzedzi, informacje o srodowisku, zawartosc CLAUDE.md itp. Bloki z `cache_control` sa buforowane przez prompt caching |
| **tools** | array | Lista definicji dostepnych narzedzi. Kazde narzedzie zawiera `name`, `description` i `input_schema` (JSON Schema). MainAgent ma zwykle 20+ narzedzi, SubAgent ma tylko kilka |
| **metadata** | object | Metadane zadania, zwykle zawiera `user_id` do identyfikacji uzytkownika |
| **max_tokens** | number | Maksymalna liczba tokenow w pojedynczej odpowiedzi modelu, np. `16000`, `64000` |
| **thinking** | object | Konfiguracja rozszerzonego myslenia. `type: "enabled"` wlacza tryb myslenia, `budget_tokens` kontroluje gorny limit tokenow myslenia |
| **context_management** | object | Konfiguracja zarzadzania kontekstem. `truncation: "auto"` pozwala Claude Code automatycznie obcinac zbyt dluga historie wiadomosci |
| **output_config** | object | Konfiguracja wyjscia, np. ustawienia `format` |
| **stream** | boolean | Czy wlaczyc odpowiedzi strumieniowe. Claude Code zawsze uzywa `true` |

## Struktura messages

`content` kazdej wiadomosci to tablica blokow, typowe typy:

- **text**: Zwykla zawartosc tekstowa
- **tool_use**: Model wywoluje narzedzie (zawiera `name`, `input`)
- **tool_result**: Wynik wykonania narzedzia (zawiera `tool_use_id`, `content`)
- **image**: Zawartosc obrazu (base64 lub URL)
- **thinking**: Proces myslenia modelu (tryb rozszerzonego myslenia)

## Struktura system

Tablica system prompt zwykle zawiera:

1. **Glowne instrukcje agenta** ("You are Claude Code...")
2. **Zasady uzycia narzedzi**
3. **Zawartosc CLAUDE.md** (instrukcje na poziomie projektu)
4. **Przypomnienia o umiejetnosciach** (skills reminder)
5. **Informacje o srodowisku** (OS, shell, status git itp.) — w rzeczywistosci Claude Code jest bardzo zalezny od git. Jesli projekt posiada repozytorium git, Claude Code moze wykazac lepsze zrozumienie projektu, w tym pobierac zdalne zmiany i historie commitow do analizy

Bloki oznaczone `cache_control: { type: "ephemeral" }` sa buforowane przez Anthropic API przez 5 minut. Przy trafieniu w bufor sa rozliczane jako `cache_read_input_tokens` (znacznie taniej niz `input_tokens`).

> **Uwaga**: W przypadku specjalizowanych klientow takich jak Claude Code, serwer Anthropic w rzeczywistosci nie polega calkowicie na atrybucie `cache_control` w zadaniu do okreslenia zachowania buforowania. Serwer automatycznie stosuje strategie buforowania dla okreslonych pol (takich jak system prompt i definicje tools), nawet jesli zadanie nie zawiera jawnie znacznika `cache_control`. Dlatego nie musisz sie dziwic, gdy nie widzisz tego atrybutu w request body — serwer juz wykonal operacje buforowania za kulisami, po prostu nie ujawnia tej informacji klientowi. To milczace porozumienie miedzy Claude Code a Anthropic API.
