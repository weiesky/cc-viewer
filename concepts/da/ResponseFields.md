# Feltbeskrivelse for Response Body

Feltbeskrivelse for responslegemet i Claude API `/v1/messages`.

## Felter på øverste niveau

| Felt | Type | Beskrivelse |
|------|------|------|
| **model** | string | Det faktiske modelnavn, f.eks. `claude-opus-4-6` |
| **id** | string | Unik identifikator for dette svar, f.eks. `msg_01Tgsr2QeH8AVXGoP2wAXRvU` |
| **type** | string | Fast værdi `"message"` |
| **role** | string | Fast værdi `"assistant"` |
| **content** | array | Array af indholdsblokke fra modellens output, herunder tekst, værktøjskald, tænkeproces m.m. |
| **stop_reason** | string | Stopårsag: `"end_turn"` (normal afslutning), `"tool_use"` (værktøj skal udføres), `"max_tokens"` (token-grænse nået) |
| **stop_sequence** | string/null | Den sekvens der udløste stop, normalt `null` |
| **usage** | object | Statistik over tokenforbrug (se nedenfor) |

## content-bloktyper

| Type | Beskrivelse |
|------|------|
| **text** | Modellens tekstsvar, indeholder feltet `text` |
| **tool_use** | Anmodning om værktøjskald, indeholder `name` (værktøjsnavn), `input` (parametre), `id` (kalds-ID, bruges til at matche tool_result) |
| **thinking** | Udvidet tænkeindhold (vises kun når thinking-tilstand er aktiveret), indeholder feltet `thinking` |

## Detaljer om usage-feltet

| Felt | Beskrivelse |
|------|------|
| **input_tokens** | Antal input-tokens uden cache-hit (faktureres til fuld pris) |
| **cache_creation_input_tokens** | Antal tokens der blev cachet i denne anmodning (cache-skrivning, faktureres højere end normalt input) |
| **cache_read_input_tokens** | Antal tokens med cache-hit (cache-læsning, faktureres væsentligt lavere end normalt input) |
| **output_tokens** | Antal tokens i modellens output |
| **service_tier** | Serviceniveau, f.eks. `"standard"` |
| **inference_geo** | Inferensregion, f.eks. `"not_available"` angiver at regionsinformation ikke er tilgængelig |

## cache_creation-underfelter

| Felt | Beskrivelse |
|------|------|
| **ephemeral_5m_input_tokens** | Antal tokens for korttids-cacheoprettelse med 5 minutters TTL |
| **ephemeral_1h_input_tokens** | Antal tokens for langtids-cacheoprettelse med 1 times TTL |

> **Om cache-fakturering**: Enhedsprisen for `cache_read_input_tokens` er væsentligt lavere end for `input_tokens`, mens enhedsprisen for `cache_creation_input_tokens` er lidt højere end normalt input. Derfor kan en høj cache-hitrate i løbende samtaler reducere omkostningerne markant. Via "hitrate"-metrikken i cc-viewer kan du nemt overvåge dette forhold.

## Betydning af stop_reason

- **end_turn**: Modellen har afsluttet sit svar normalt
- **tool_use**: Modellen skal kalde et værktøj, og content vil indeholde en `tool_use`-blok. I den næste anmodning skal `tool_result` tilføjes i messages for at fortsætte samtalen
- **max_tokens**: `max_tokens`-grænsen er nået og svaret er afkortet, det kan være ufuldstændigt
