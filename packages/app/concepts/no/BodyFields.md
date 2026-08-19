# Beskrivelse av Request Body-felt

Beskrivelse av toppnivåfeltene i Claude API `/v1/messages` request body.

## Feltliste

| Felt | Type | Beskrivelse |
|------|------|------|
| **model** | string | Navnet på modellen som brukes, f.eks. `claude-opus-4-6`, `claude-sonnet-4-6` |
| **messages** | array | Samtalens meldingshistorikk. Hver melding inneholder `role` (user/assistant) og `content` (et block-array med tekst, bilder, tool_use, tool_result osv.) |
| **system** | array | System prompt. Inneholder Claude Codes kjerneinstruksjoner, veiledning for verktøybruk, miljøinformasjon, CLAUDE.md-innhold m.m. Blokker med `cache_control` blir cachet via prompt caching |
| **tools** | array | Liste over tilgjengelige verktøydefinisjoner. Hvert verktøy inneholder `name`, `description` og `input_schema` (JSON Schema). MainAgent har vanligvis 20+ verktøy, SubAgent har bare noen få |
| **metadata** | object | Request-metadata, inneholder vanligvis `user_id` for brukeridentifikasjon |
| **max_tokens** | number | Maksimalt antall tokens i et enkelt modellsvar, f.eks. `16000`, `64000` |
| **thinking** | object | Konfigurasjon for utvidet tenkning. `type: "enabled"` aktiverer tenkemodus, `budget_tokens` styrer øvre grense for tenke-tokens |
| **context_management** | object | Konfigurasjon for kontekststyring. `truncation: "auto"` lar Claude Code automatisk avkorte for lange meldingshistorikker |
| **output_config** | object | Utdatakonfigurasjon, f.eks. `format`-innstillinger |
| **stream** | boolean | Om strømmende svar er aktivert. Claude Code bruker alltid `true` |

## messages-struktur

Hver meldings `content` er et block-array med vanlige typer:

- **text**: Vanlig tekstinnhold
- **tool_use**: Modellen kaller et verktøy (inneholder `name`, `input`)
- **tool_result**: Resultatet av verktøyutførelse (inneholder `tool_use_id`, `content`)
- **image**: Bildeinnhold (base64 eller URL)
- **thinking**: Modellens tenkeprosess (utvidet tenkemodus)

## system-struktur

System prompt-arrayet inneholder vanligvis:

1. **Kjerne-agent-instruksjoner** ("You are Claude Code...")
2. **Regler for verktøybruk**
3. **CLAUDE.md-innhold** (prosjektspesifikke instruksjoner)
4. **Ferdighetspåminnelser** (skills reminder)
5. **Miljøinformasjon** (OS, shell, git-status osv.) — Claude Code er faktisk svært avhengig av git. Hvis prosjektet har et git-repository, kan Claude Code vise bedre forståelse av prosjektet, inkludert henting av fjernendringer og commit-historikk for analyse

Blokker merket med `cache_control: { type: "ephemeral" }` caches av Anthropic API i 5 minutter. Ved cache-treff faktureres de som `cache_read_input_tokens` (betydelig billigere enn `input_tokens`).

> **Merk**: For spesialiserte klienter som Claude Code er Anthropic-serveren faktisk ikke fullstendig avhengig av `cache_control`-attributten i requesten for å bestemme cacheoppførsel. Serveren anvender automatisk cachestrategier for bestemte felt (som system prompt og tools-definisjoner), selv når requesten ikke eksplisitt inneholder `cache_control`-merking. Derfor trenger du ikke undre deg når du ikke ser denne attributten i request body — serveren har allerede utført cacheoperasjonen bak kulissene, men viser det bare ikke til klienten. Det er en stilltiende avtale mellom Claude Code og Anthropic API.
