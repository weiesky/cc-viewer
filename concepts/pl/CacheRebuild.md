# Cache Rebuild (przebudowa cache)

## Kontekst

Mechanizm prompt caching Anthropic łączy system → tools → messages (do punktu przerwania cache) w klucz cache. Gdy klucz cache jest identyczny z poprzednim żądaniem, API zwraca `cache_read_input_tokens` (trafienie cache); gdy klucz cache się zmieni, API tworzy cache od nowa, zwracając dużą liczbę `cache_creation_input_tokens`, czyli przebudowę cache.

Przebudowa cache oznacza dodatkowe koszty tokenów (cena cache creation jest wyższa niż cache read), dlatego identyfikacja przyczyn przebudowy ma bezpośrednią wartość dla optymalizacji kosztów.

## Klasyfikacja przyczyn przebudowy cache

cc-viewer porównuje treści dwóch kolejnych żądań MainAgent, aby precyzyjnie określić przyczynę przebudowy cache:

| reason | Znaczenie | Sposób określenia |
|--------|------|----------|
| `ttl` | Cache wygasł | Od poprzedniego żądania MainAgent upłynęło ponad 5 minut |
| `system_change` | Zmiana system prompt | `JSON.stringify(prev.system) !== JSON.stringify(curr.system)` |
| `tools_change` | Zmiana definicji narzędzi | `JSON.stringify(prev.tools) !== JSON.stringify(curr.tools)` |
| `model_change` | Zmiana modelu | `prev.model !== curr.model` |
| `msg_truncated` | Obcięcie stosu wiadomości | Bieżące żądanie ma mniej wiadomości niż poprzednie, zazwyczaj z powodu obcięcia wywołanego przepełnieniem okna kontekstu |
| `msg_modified` | Modyfikacja historii wiadomości | Treść wiadomości prefiksowych jest niespójna (przy normalnym dopisywaniu prefiks powinien być identyczny) |
| `key_change` | Nieznana zmiana klucza | Fallback, gdy żaden z powyższych warunków nie pasuje |

## Priorytet określania

1. Najpierw sprawdzany jest odstęp czasowy — ponad 5 minut oznacza bezpośrednio `ttl`, bez porównywania treści
2. Następnie kolejno sprawdzane są: model, system, tools, messages
3. Jedno żądanie może jednocześnie spełniać wiele przyczyn (np. zmiana modelu + zmiana system prompt), wtedy tablica `reasons` zawiera wszystkie pasujące elementy, a tooltip wyświetla je w osobnych wierszach

## Typowe scenariusze

- **`ttl`**: użytkownik wstrzymał pracę na ponad 5 minut, cache naturalnie wygasł
- **`system_change`**: Claude Code zaktualizował system prompt (np. załadowanie nowego CLAUDE.md, zmiana instrukcji projektu)
- **`tools_change`**: połączenie/rozłączenie serwera MCP spowodowało zmianę listy dostępnych narzędzi
- **`model_change`**: użytkownik przełączył model poleceniem `/model`
- **`msg_truncated`**: zbyt długi dialog wywołał zarządzanie oknem kontekstu, Claude Code obciął wcześniejsze wiadomości
- **`msg_modified`**: Claude Code edytował historyczne wiadomości (np. `/compact` zastąpił oryginalne wiadomości skompresowanym podsumowaniem)
