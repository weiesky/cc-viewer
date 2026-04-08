# MainAgent

## Definicja

MainAgent to główny łańcuch żądań Claude Code w trybie bez agent team. Każda interakcja użytkownika z Claude Code generuje serię żądań API, z których żądania MainAgent tworzą główny łańcuch dialogu — zawierają pełny system prompt, definicje narzędzi i historię wiadomości.

## Sposób identyfikacji

W cc-viewer MainAgent jest identyfikowany przez `req.mainAgent === true`, automatycznie oznaczany przez `interceptor.js` podczas przechwytywania żądania.

Warunki kwalifikacji (wszystkie muszą być spełnione):
- Treść żądania zawiera pole `system` (system prompt)
- Treść żądania zawiera tablicę `tools` (definicje narzędzi)
- System prompt zawiera tekst charakterystyczny dla "Claude Code"

## Różnice względem SubAgent

| Cecha | MainAgent | SubAgent |
|------|-----------|----------|
| system prompt | Pełny główny prompt Claude Code | Uproszczony prompt dedykowany zadaniu |
| tablica tools | Zawiera wszystkie dostępne narzędzia | Zazwyczaj zawiera tylko kilka narzędzi potrzebnych do zadania |
| historia wiadomości | Kumuluje pełny kontekst dialogu | Zawiera tylko wiadomości związane z podzadaniem |
| zachowanie cache | Prompt caching (5 minut TTL) | Zazwyczaj bez cache lub z małym cache |
