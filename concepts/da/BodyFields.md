# Beskrivelse af Request Body-felter

Beskrivelse af topniveau-felterne i Claude API `/v1/messages` request body.

## Feltliste

| Felt | Type | Beskrivelse |
|------|------|------|
| **model** | string | Navnet på den anvendte model, f.eks. `claude-opus-4-6`, `claude-sonnet-4-6` |
| **messages** | array | Samtalens beskedhistorik. Hver besked indeholder `role` (user/assistant) og `content` (et block-array med tekst, billeder, tool_use, tool_result osv.) |
| **system** | array | System prompt. Indeholder Claude Codes kerneinstruktioner, vejledning til brug af værktøjer, miljøoplysninger, CLAUDE.md-indhold m.m. Blokke med `cache_control` cachelagres via prompt caching |
| **tools** | array | Liste over tilgængelige værktøjsdefinitioner. Hvert værktøj indeholder `name`, `description` og `input_schema` (JSON Schema). MainAgent har typisk 20+ værktøjer, SubAgent har kun få |
| **metadata** | object | Request-metadata, indeholder typisk `user_id` til brugeridentifikation |
| **max_tokens** | number | Maksimalt antal tokens i et enkelt modelsvar, f.eks. `16000`, `64000` |
| **thinking** | object | Konfiguration af udvidet tænkning. `type: "enabled"` aktiverer tænketilstand, `budget_tokens` styrer øvre grænse for tænke-tokens |
| **context_management** | object | Konfiguration af kontekststyring. `truncation: "auto"` tillader Claude Code automatisk at afkorte for lange beskedhistorikker |
| **output_config** | object | Outputkonfiguration, f.eks. `format`-indstillinger |
| **stream** | boolean | Om streaming-svar er aktiveret. Claude Code bruger altid `true` |

## messages-struktur

Hver beskeds `content` er et block-array med følgende almindelige typer:

- **text**: Almindeligt tekstindhold
- **tool_use**: Modellen kalder et værktøj (indeholder `name`, `input`)
- **tool_result**: Resultatet af værktøjsudførelse (indeholder `tool_use_id`, `content`)
- **image**: Billedindhold (base64 eller URL)
- **thinking**: Modellens tænkeproces (udvidet tænketilstand)

## system-struktur

System prompt-arrayet indeholder typisk:

1. **Kerne-agent-instruktioner** ("You are Claude Code...")
2. **Regler for brug af værktøjer**
3. **CLAUDE.md-indhold** (projektspecifikke instruktioner)
4. **Færdighedspåmindelser** (skills reminder)
5. **Miljøoplysninger** (OS, shell, git-status osv.) — Claude Code er faktisk meget afhængig af git. Hvis projektet har et git-repository, kan Claude Code vise bedre forståelse af projektet, herunder hente fjernændringer og commit-historik til analyse

Blokke markeret med `cache_control: { type: "ephemeral" }` cachelagres af Anthropic API i 5 minutter. Ved cache-hit faktureres de som `cache_read_input_tokens` (betydeligt billigere end `input_tokens`).

> **Bemærk**: For specialiserede klienter som Claude Code er Anthropic-serveren faktisk ikke fuldstændigt afhængig af `cache_control`-attributten i requesten til at bestemme cacheadfærd. Serveren anvender automatisk cachestrategier for bestemte felter (som system prompt og tools-definitioner), selv når requesten ikke eksplicit indeholder `cache_control`-markering. Derfor behøver du ikke undre dig, når du ikke ser denne attribut i request body — serveren har allerede udført cacheoperationen bag kulisserne, men viser det bare ikke til klienten. Det er en stiltiende aftale mellem Claude Code og Anthropic API.
