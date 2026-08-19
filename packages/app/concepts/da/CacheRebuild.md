# Cache Rebuild (cache-genopbygning)

## Baggrund

Anthropics prompt caching-mekanisme sammenkæder system → tools → messages (til cache breakpoint) fra requesten i rækkefølge som cache-nøgle. Når cache-nøglen er identisk med den forrige request, returnerer API'en `cache_read_input_tokens` (cache hit); når cache-nøglen ændres, genskaber API'en cachen og returnerer et stort antal `cache_creation_input_tokens`, dvs. cache-genopbygning.

Cache-genopbygning medfører ekstra token-omkostninger (prisen for cache creation er højere end cache read), så det har direkte værdi for omkostningsoptimering at identificere årsagen til genopbygningen.

## Klassificering af årsager til cache-genopbygning

cc-viewer sammenligner body fra to på hinanden følgende MainAgent-requests for præcist at bestemme årsagen til cache-genopbygningen:

| reason | Betydning | Bestemmelsesmetode |
|--------|------|----------|
| `ttl` | Cache udløbet | Der er gået mere end 5 minutter siden sidste MainAgent-request |
| `system_change` | System prompt ændret | `JSON.stringify(prev.system) !== JSON.stringify(curr.system)` |
| `tools_change` | Værktøjsdefinitioner ændret | `JSON.stringify(prev.tools) !== JSON.stringify(curr.tools)` |
| `model_change` | Model skiftet | `prev.model !== curr.model` |
| `msg_truncated` | Beskedstakken afkortet | Antallet af beskeder i den aktuelle request er mindre end i den forrige, normalt udløst af afkortning pga. kontekstvindue-overflow |
| `msg_modified` | Historiske beskeder ændret | Præfiks-beskedernes indhold er inkonsistent (ved normal tilføjelse bør præfikset være identisk) |
| `key_change` | Ukendt nøgleændring | Fallback når ingen af ovenstående betingelser matcher |

## Bestemmelsesprioritering

1. Først kontrolleres tidsintervallet — over 5 minutter bestemmes direkte som `ttl`, uden body-sammenligning
2. Derefter kontrolleres i rækkefølge model, system, tools, messages
3. En request kan matche flere årsager samtidigt (f.eks. modelskift + system prompt-ændring); i så fald indeholder `reasons`-arrayet alle matchende elementer, og tooltip'en viser dem på separate linjer

## Almindelige scenarier

- **`ttl`**: brugeren pauserede i mere end 5 minutter og fortsatte derefter, cachen udløb naturligt
- **`system_change`**: Claude Code opdaterede system prompten (f.eks. indlæsning af ny CLAUDE.md, ændring af project instructions)
- **`tools_change`**: tilslutning/frakobling af MCP-server medførte ændring af listen over tilgængelige værktøjer
- **`model_change`**: brugeren skiftede model via `/model`-kommandoen
- **`msg_truncated`**: en for lang samtale udløste kontekstvindue-styring, Claude Code afkortede tidlige beskeder
- **`msg_modified`**: Claude Code redigerede historiske beskeder (f.eks. `/compact` erstattede originale beskeder med et komprimeret resumé)
