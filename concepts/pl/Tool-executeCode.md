# executeCode (mcp__ide__executeCode)

## Definicja

Wykonuje kod Python w jądrze Jupyter bieżącego pliku notebook.

## Parametry

| Parametr | Typ | Wymagany | Opis |
|------|------|------|------|
| `code` | string | Tak | Kod Python do wykonania |

## Scenariusze użycia

**Odpowiednie zastosowanie:**
- Wykonywanie kodu w środowisku Jupyter notebook
- Testowanie fragmentów kodu
- Analiza danych i obliczenia

**Nieodpowiednie zastosowanie:**
- Wykonywanie kodu poza środowiskiem Jupyter — należy użyć Bash
- Modyfikacja plików — należy użyć Edit lub Write

## Uwagi

- To jest narzędzie MCP (Model Context Protocol), dostarczane przez integrację z IDE
- Kod jest wykonywany w bieżącym jądrze Jupyter, stan jest zachowywany między wywołaniami
- O ile użytkownik wyraźnie nie poprosi, należy unikać deklarowania zmiennych lub modyfikowania stanu jądra
- Po restarcie jądra stan zostaje utracony

## Znaczenie w cc-viewer

executeCode to narzędzie MCP, pojawiające się w tablicy `tools` logów żądań pod nazwą `mcp__ide__executeCode`. Jego wywołania i zwroty podlegają standardowemu wzorcowi `tool_use` / `tool_result`. Dodawanie/usuwanie narzędzi MCP powoduje zmianę tablicy tools, co może wyzwolić przebudowę cache.

## Tekst oryginalny

<textarea readonly>Execute python code in the Jupyter kernel for the current notebook file.
    
    All code will be executed in the current Jupyter kernel.
    
    Avoid declaring variables or modifying the state of the kernel unless the user
    explicitly asks for it.
    
    Any code executed will persist across calls to this tool, unless the kernel
    has been restarted.</textarea>
