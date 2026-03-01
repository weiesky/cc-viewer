# getDiagnostics (mcp__ide__getDiagnostics)

## Definicja

Pobiera informacje diagnostyczne języka z VS Code, w tym błędy składni, błędy typów, ostrzeżenia lint itp.

## Parametry

| Parametr | Typ | Wymagany | Opis |
|------|------|------|------|
| `uri` | string | Nie | URI pliku. Jeśli nie podano, pobiera diagnostykę wszystkich plików |

## Scenariusze użycia

**Odpowiednie zastosowanie:**
- Sprawdzanie problemów semantycznych kodu: składnia, typy, lint itp.
- Weryfikacja po edycji kodu, czy nie wprowadzono nowych błędów
- Zastępowanie poleceń Bash do sprawdzania jakości kodu

**Nieodpowiednie zastosowanie:**
- Uruchamianie testów — należy użyć Bash
- Sprawdzanie błędów runtime — należy użyć Bash do wykonania kodu

## Uwagi

- To jest narzędzie MCP (Model Context Protocol), dostarczane przez integrację z IDE
- Dostępne tylko w środowisku VS Code / IDE
- Preferuj użycie tego narzędzia zamiast poleceń Bash do sprawdzania problemów z kodem

## Znaczenie w cc-viewer

getDiagnostics to narzędzie MCP, pojawiające się w tablicy `tools` logów żądań pod nazwą `mcp__ide__getDiagnostics`. Jego wywołania i zwroty podlegają standardowemu wzorcowi `tool_use` / `tool_result`. Dodawanie/usuwanie narzędzi MCP powoduje zmianę tablicy tools, co może wyzwolić przebudowę cache.

## Tekst oryginalny

<textarea readonly>Get language diagnostics from VS Code</textarea>
