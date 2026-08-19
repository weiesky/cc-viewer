# Zawartość pamięci podręcznej KV-Cache

## Czym jest Prompt Caching?

Gdy rozmawiasz z Claude, każde żądanie API wysyła pełny kontekst konwersacji (system prompt + definicje narzędzi + historia wiadomości). Mechanizm prompt caching Anthropica buforuje na serwerze już obliczoną zawartość prefiksu, a jeśli prefiks jest taki sam przy kolejnych żądaniach, wynik z pamięci podręcznej jest bezpośrednio wykorzystywany ponownie, pomijając powtórne obliczenia i znacząco redukując opóźnienia i koszty.

W cc-viewer mechanizm ten nazywany jest "KV-Cache" i odpowiada prompt cachingowi na poziomie Anthropic API — a nie pamięci podręcznej key-value w warstwach uwagi transformera wewnątrz LLM.

## Jak działa pamięć podręczna

Prompt caching Anthropica łączy klucze pamięci podręcznej w stałej kolejności:

```
Tools → System Prompt → Messages (do cache breakpoint)
```

Dopóki ten prefiks jest całkowicie identyczny z dowolnym żądaniem w oknie TTL, API trafi w pamięć podręczną (zwraca `cache_read_input_tokens`) zamiast obliczać ponownie (`cache_creation_input_tokens`).

> **Claude Code nie jest silnie zależny od atrybutu `cache_control` — serwer usuwa niektóre z tych atrybutów, ale nadal potrafi prawidłowo tworzyć pamięć podręczną, więc brak atrybutu `cache_control` nie oznacza, że zawartość nie jest buforowana**
>
> Dla specjalnych klientów takich jak Claude Code, serwer Anthropica nie jest całkowicie zależny od atrybutu `cache_control` w żądaniu do określenia zachowania pamięci podręcznej. Serwer automatycznie stosuje strategie buforowania dla określonych pól (takich jak system prompt i definicje narzędzi), nawet gdy żądanie nie zawiera jawnie znaczników `cache_control`. Dlatego nie musisz się dziwić, gdy nie widzisz tego atrybutu w treści żądania — serwer już wykonał operację buforowania za kulisami, po prostu nie ujawnił tej informacji klientowi. Jest to milczące porozumienie między Claude Code a Anthropic API.

## Czym jest "bieżąca zawartość pamięci podręcznej KV-Cache"?

"Bieżąca zawartość pamięci podręcznej KV-Cache" wyświetlana w cc-viewer to zawartość wyodrębniona z ostatniego żądania MainAgent, znajdująca się przed granicą pamięci podręcznej (cache breakpoint). Obejmuje konkretnie:

- **System Prompt**: Instrukcje systemowe Claude Code, w tym podstawowe instrukcje agenta, zasady korzystania z narzędzi, instrukcje projektu CLAUDE.md, informacje o środowisku itp.
- **Tools**: Lista aktualnie dostępnych definicji narzędzi (takich jak Read, Write, Bash, Agent, narzędzia MCP itp.)
- **Messages**: Buforowana część historii konwersacji (zwykle starsze wiadomości, do ostatniego znacznika `cache_control`)

## Dlaczego warto przeglądać zawartość pamięci podręcznej?

1. **Zrozumienie kontekstu**: Dowiedz się, jaką zawartość Claude aktualnie "pamięta", i oceń, czy jego zachowanie jest zgodne z oczekiwaniami
2. **Optymalizacja kosztów**: Trafienie w pamięć podręczną kosztuje znacznie mniej niż ponowne obliczenia. Przeglądanie zawartości pamięci podręcznej pomaga zrozumieć, dlaczego niektóre żądania wyzwoliły przebudowę pamięci podręcznej (cache rebuild)
3. **Debugowanie konwersacji**: Gdy odpowiedź Claude nie jest zgodna z oczekiwaniami, sprawdzenie zawartości pamięci podręcznej pozwala potwierdzić, czy system prompt i historia wiadomości są poprawne
4. **Monitorowanie jakości kontekstu**: Podczas debugowania, modyfikacji konfiguracji lub dostosowywania promptów, KV-Cache-Text zapewnia scentralizowaną perspektywę, pomagającą szybko potwierdzić, czy kontekst główny nie uległ pogorszeniu lub nie został zanieczyszczony nieoczekiwaną zawartością — bez konieczności przeglądania oryginalnych wiadomości po kolei

## Wielopoziomowa strategia pamięci podręcznej

Pamięć KV-Cache odpowiadająca Claude Code nie jest pojedynczą pamięcią podręczną. Serwer generuje oddzielne pamięci podręczne dla Tools i System Prompt, niezależnie od pamięci podręcznej Messages. Zaletą tego projektu jest to, że gdy stos wiadomości zostaje zakłócony (np. obcinanie kontekstu, modyfikacja wiadomości) i wymaga przebudowy, nie unieważnia to jednocześnie pamięci podręcznych Tools i System Prompt, unikając pełnego ponownego obliczania.

Jest to strategia optymalizacji po stronie serwera — ponieważ definicje Tools i System Prompt są stosunkowo stabilne podczas normalnego użytkowania i rzadko się zmieniają, oddzielne buforowanie ich maksymalizuje redukcję niepotrzebnych kosztów przebudowy. Dlatego obserwując pamięć podręczną, zauważysz, że oprócz przebudowy Tools, która wymaga pełnego odświeżenia wszystkich pamięci podręcznych, zniszczenie System Prompt i Messages nadal pozwala na dziedziczenie dostępnych pamięci podręcznych.

## Cykl życia pamięci podręcznej

- **Tworzenie**: Przy pierwszym żądaniu lub po wygaśnięciu pamięci podręcznej, API tworzy nową pamięć podręczną (`cache_creation_input_tokens`)
- **Trafienie**: Kolejne żądania z identycznym prefiksem ponownie wykorzystują pamięć podręczną (`cache_read_input_tokens`)
- **Wygaśnięcie**: Pamięć podręczna ma TTL (czas życia) wynoszący 5 minut i automatycznie wygasa po tym czasie
- **Przebudowa**: Gdy system prompt, lista narzędzi, model lub zawartość wiadomości się zmienią, klucz pamięci podręcznej nie pasuje, wyzwalając przebudowę odpowiedniego poziomu
