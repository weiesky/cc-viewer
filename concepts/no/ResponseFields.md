# Feltbeskrivelse for Response Body

Feltbeskrivelse for responskroppen i Claude API `/v1/messages`.

## Toppnivåfelter

| Felt | Type | Beskrivelse |
|------|------|------|
| **model** | string | Det faktiske modellnavnet, f.eks. `claude-opus-4-6` |
| **id** | string | Unik identifikator for dette svaret, f.eks. `msg_01Tgsr2QeH8AVXGoP2wAXRvU` |
| **type** | string | Fast verdi `"message"` |
| **role** | string | Fast verdi `"assistant"` |
| **content** | array | Array med innholdsblokker fra modellens utdata, inkludert tekst, verktøykall, tenkeprosess m.m. |
| **stop_reason** | string | Stoppårsak: `"end_turn"` (normal avslutning), `"tool_use"` (verktøy må utføres), `"max_tokens"` (token-grense nådd) |
| **stop_sequence** | string/null | Sekvensen som utløste stopp, vanligvis `null` |
| **usage** | object | Statistikk over tokenforbruk (se nedenfor) |

## content-blokktyper

| Type | Beskrivelse |
|------|------|
| **text** | Modellens tekstsvar, inneholder feltet `text` |
| **tool_use** | Forespørsel om verktøykall, inneholder `name` (verktøynavn), `input` (parametere), `id` (kall-ID, brukes til å matche tool_result) |
| **thinking** | Utvidet tenkeinnhold (vises kun når thinking-modus er aktivert), inneholder feltet `thinking` |

## Detaljer om usage-feltet

| Felt | Beskrivelse |
|------|------|
| **input_tokens** | Antall input-tokens uten cache-treff (faktureres til full pris) |
| **cache_creation_input_tokens** | Antall tokens som ble cachet i denne forespørselen (cache-skriving, faktureres høyere enn vanlig input) |
| **cache_read_input_tokens** | Antall tokens med cache-treff (cache-lesing, faktureres vesentlig lavere enn vanlig input) |
| **output_tokens** | Antall tokens i modellens utdata |
| **service_tier** | Tjenestenivå, f.eks. `"standard"` |
| **inference_geo** | Inferensregion, f.eks. `"not_available"` betyr at regionsinformasjon ikke er tilgjengelig |

## cache_creation-underfelt

| Felt | Beskrivelse |
|------|------|
| **ephemeral_5m_input_tokens** | Antall tokens for korttids-cacheoppretting med 5 minutters TTL |
| **ephemeral_1h_input_tokens** | Antall tokens for langtids-cacheoppretting med 1 times TTL |

> **Om cache-fakturering**: Enhetsprisen for `cache_read_input_tokens` er vesentlig lavere enn for `input_tokens`, mens enhetsprisen for `cache_creation_input_tokens` er noe høyere enn vanlig input. Derfor kan en høy cache-treffrate i pågående samtaler redusere kostnadene betydelig. Via "treffrate"-metrikken i cc-viewer kan du enkelt overvåke dette forholdet.

## Betydningen av stop_reason

- **end_turn**: Modellen har fullført svaret normalt
- **tool_use**: Modellen må kalle et verktøy, og content vil inneholde en `tool_use`-blokk. I neste forespørsel må `tool_result` legges til i messages for å fortsette samtalen
- **max_tokens**: `max_tokens`-grensen er nådd og svaret er avkortet, det kan være ufullstendig
