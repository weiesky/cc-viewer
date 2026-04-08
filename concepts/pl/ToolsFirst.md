# Dlaczego Tools są wyświetlane jako pierwsze?

W panelu kontekstu cc-viewer **Tools pojawiają się przed System Prompt i Messages**. Ta kolejność dokładnie odzwierciedla **sekwencję prefiksu KV-Cache w Anthropic API**.

## Sekwencja prefiksu KV-Cache

Gdy Anthropic API buduje KV-Cache, łączy kontekst w prefiks w tej **stałej kolejności**:

```
┌─────────────────────────────────────────────────┐
│ 1. Tools (JSON Schema definitions)               │  ← Start of cache prefix
│ 2. System Prompt                                 │
│ 3. Messages (conversation history + current turn)│  ← End of cache prefix
└─────────────────────────────────────────────────┘
```

Oznacza to, że **Tools znajdują się przed System Prompt na samym początku prefiksu cache**.

## Dlaczego Tools mają większy wpływ na cache niż System?

W dopasowywaniu prefiksu KV-Cache **wcześniejsza treść jest bardziej krytyczna** — każda zmiana unieważnia wszystko, co po niej następuje:

1. **Dopasowywanie prefiksu zaczyna się od początku**: KV-Cache porównuje bieżące żądanie z zbuforowanym prefiksem token po tokenie od początku. W momencie znalezienia niezgodności cała późniejsza treść zostaje unieważniona.

2. **Zmiana Tools = cały cache unieważniony**: Ponieważ Tools są na pierwszym miejscu, każda zmiana w definicjach narzędzi (nawet dodanie lub usunięcie jednego MCP tool) **przerywa prefiks od samego początku**, unieważniając cały zbuforowany System Prompt i Messages.

3. **Zmiana System = cache Messages unieważniony**: System Prompt znajduje się w środku, więc jego zmiany unieważniają tylko następującą po nim część Messages.

4. **Zmiana Messages = dotyczy tylko końca**: Messages są na końcu, więc dołączanie nowych wiadomości unieważnia jedynie niewielki końcowy segment — cache Tools i System pozostaje nienaruszony.

## Praktyczny wpływ

| Typ zmiany | Wpływ na cache | Typowy scenariusz |
|------------|---------------|-------------------|
| Tool dodane/usunięte | **Pełne unieważnienie** | Połączenie/rozłączenie serwera MCP, włączenie/wyłączenie wtyczki IDE |
| Zmiana System Prompt | Utrata cache Messages | Edycja CLAUDE.md, wstrzyknięcie system reminder |
| Nowa wiadomość dodana | Tylko przyrost końcowy | Normalny przepływ rozmowy (najczęstszy, najtańszy) |

Dlatego `tools_change` w [CacheRebuild](CacheRebuild.md) jest zazwyczaj najdroższym powodem przebudowy — przerywa łańcuch prefiksu na samym początku.

## Dlaczego definicje narzędzi są umieszczone przed "mózgiem"?

Z perspektywy cache'owania, umieszczenie Tools na pierwszym miejscu jest faktem technicznym. Ale z perspektywy projektowania kognitywnego ta kolejność jest równie logiczna — **Tools to ręce i nogi, System Prompt to mózg**.

Przed podjęciem działania człowiek musi rozpoznać, jakie kończyny i narzędzia ma do dyspozycji. Niemowlę nie rozumie najpierw zasad świata (System), a potem uczy się chwytać — najpierw wyczuwa, że ma ręce i nogi, a następnie stopniowo rozumie zasady przez interakcję ze środowiskiem. Podobnie LLM musi wiedzieć, jakie narzędzia może wywołać (czytanie plików, pisanie kodu, wyszukiwanie, wykonywanie poleceń) przed otrzymaniem instrukcji zadania (System Prompt), aby móc dokładnie ocenić "co mogę zrobić" i "jak powinienem to zrobić" podczas przetwarzania instrukcji.

Gdyby było odwrotnie — najpierw powiedzieć modelowi "twoim zadaniem jest refaktoryzacja tego modułu", potem "masz narzędzia Read, Edit, Bash" — modelowi brakowałoby kluczowych informacji o granicach swoich możliwości przy rozumieniu zadania, co mogłoby prowadzić do nierealistycznych planów lub pominięcia dostępnych podejść.

**Poznaj swoje karty zanim zdecydujesz, jak grać.** To jest logika kognitywna stojąca za umieszczeniem Tools przed System.

## Dlaczego narzędzia MCP również znajdują się na tej pozycji?

Narzędzia MCP (Model Context Protocol), podobnie jak narzędzia wbudowane, są umieszczone na samym początku obszaru Tools. Zrozumienie pozycji MCP w kontekście pomaga ocenić jego realne korzyści i koszty.

### Zalety MCP

- **Rozszerzenie możliwości**: MCP pozwala modelom na dostęp do usług zewnętrznych (zapytania do baz danych, wywołania API, operacje IDE, sterowanie przeglądarką itp.), przekraczając granice narzędzi wbudowanych
- **Otwarty ekosystem**: Każdy może zaimplementować serwer MCP; model zyskuje nowe możliwości bez ponownego trenowania
- **Ładowanie na żądanie**: Serwery MCP mogą być selektywnie łączone/rozłączane w zależności od scenariusza, elastycznie komponując zestawy narzędzi

### Koszty MCP

- **Zabójca cache'u**: Definicja JSON Schema każdego narzędzia MCP jest dołączana na samym początku prefiksu KV-Cache. Dodanie lub usunięcie jednego narzędzia MCP = **cały cache unieważniony od początku**. Częste łączenie/rozłączanie serwerów MCP drastycznie obniża współczynnik trafień cache'u
- **Puchnięcie prefiksu**: Schematy narzędzi MCP są typowo większe niż narzędzia wbudowane (szczegółowe opisy parametrów, wartości enum itp.). Wiele narzędzi MCP znacząco zwiększa liczbę tokenów w obszarze Tools, zmniejszając przestrzeń kontekstu dostępną dla Messages
- **Narzut opóźnienia**: Wywołania narzędzi MCP wymagają komunikacji międzyprocesowej (JSON-RPC przez stdio/SSE), o rząd wielkości wolniejszej niż wywołania wbudowanych funkcji
- **Ryzyko stabilności**: Serwery MCP to procesy zewnętrzne, które mogą się zawiesić, przekroczyć limit czasu lub zwrócić nieoczekiwane formaty, wymagając dodatkowej obsługi błędów

### Praktyczne rekomendacje

| Scenariusz | Rekomendacja |
|-----------|-------------|
| Długie rozmowy, częsta interakcja | Minimalizować liczbę narzędzi MCP, aby chronić stabilność prefiksu cache'u |
| Krótkie zadania, jednorazowe operacje | Swobodnie używać narzędzi MCP; wpływ na cache jest ograniczony |
| Częste dodawanie/usuwanie serwerów MCP | Każda zmiana wywołuje pełną przebudowę cache'u; rozważyć ustalenie zestawu narzędzi |
| Zbyt duże Tool Schemas | Skrócić opisy i enumy, aby zmniejszyć zużycie tokenów prefiksu |

W panelu Context cc-viewer narzędzia MCP są wyświetlane obok narzędzi wbudowanych w obszarze Tools, dając jasny widok na rozmiar Schema każdego narzędzia i jego wkład w prefiks cache'u.
