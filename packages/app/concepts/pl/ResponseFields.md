# Opis pol Response Body

Opis pol odpowiedzi API Claude `/v1/messages`.

## Pola najwyzszego poziomu

| Pole | Typ | Opis |
|------|------|------|
| **model** | string | Rzeczywista nazwa modelu, np. `claude-opus-4-6` |
| **id** | string | Unikalny identyfikator odpowiedzi, np. `msg_01Tgsr2QeH8AVXGoP2wAXRvU` |
| **type** | string | Stala wartosc `"message"` |
| **role** | string | Stala wartosc `"assistant"` |
| **content** | array | Tablica blokow wyjsciowych modelu, zawierajaca tekst, wywolania narzedzi, proces myslowy itp. |
| **stop_reason** | string | Powod zatrzymania: `"end_turn"` (normalne zakonczenie), `"tool_use"` (wymagane wykonanie narzedzia), `"max_tokens"` (osiagnieto limit tokenow) |
| **stop_sequence** | string/null | Sekwencja wyzwalajaca zatrzymanie, zazwyczaj `null` |
| **usage** | object | Statystyki zuzycia tokenow (szczegoly ponizej) |

## Typy blokow content

| Typ | Opis |
|------|------|
| **text** | Odpowiedz tekstowa modelu, zawiera pole `text` |
| **tool_use** | Zadanie wywolania narzedzia, zawiera `name` (nazwa narzedzia), `input` (parametry), `id` (identyfikator wywolania, uzywany do dopasowania tool_result) |
| **thinking** | Rozszerzony proces myslowy (wyswietlany tylko przy wlaczonym trybie thinking), zawiera pole `thinking` |

## Szczegoly pola usage

| Pole | Opis |
|------|------|
| **input_tokens** | Liczba tokenow wejsciowych bez trafienia w cache (rozliczane po pelnej cenie) |
| **cache_creation_input_tokens** | Liczba tokenow zapisanych w cache w tym zadaniu (zapis do cache, rozliczane drozej niz zwykle wejscie) |
| **cache_read_input_tokens** | Liczba tokenow z trafieniem w cache (odczyt z cache, rozliczane znacznie taniej niz zwykle wejscie) |
| **output_tokens** | Liczba tokenow wyjsciowych modelu |
| **service_tier** | Poziom uslugi, np. `"standard"` |
| **inference_geo** | Region wnioskowania, np. `"not_available"` oznacza brak informacji o regionie |

## Podpola cache_creation

| Pole | Opis |
|------|------|
| **ephemeral_5m_input_tokens** | Liczba tokenow krotkoterminowego cache z TTL 5 minut |
| **ephemeral_1h_input_tokens** | Liczba tokenow dlugoterminowego cache z TTL 1 godzina |

> **O rozliczaniu cache**: Cena jednostkowa `cache_read_input_tokens` jest znacznie nizsza niz `input_tokens`, natomiast cena jednostkowa `cache_creation_input_tokens` jest nieco wyzsza niz zwykle wejscie. Dlatego utrzymanie wysokiego wskaznika trafien w cache podczas ciaglych rozmow moze znaczaco obnizic koszty. Za pomoca metryki "wskaznik trafien" w cc-viewer mozna latwo monitorowac te proporcje.

## Znaczenie stop_reason

- **end_turn**: Model normalnie zakonczyl odpowiedz
- **tool_use**: Model musi wywolac narzedzie, content bedzie zawierac blok `tool_use`. W nastepnym zadaniu nalezy dodac `tool_result` do messages, aby kontynuowac rozmowe
- **max_tokens**: Osiagnieto limit `max_tokens`, odpowiedz zostala obcieta i moze byc niekompletna
