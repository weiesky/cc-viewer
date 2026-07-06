# SubAgent: Search

## Definicja

Search jest typem pod-agenta uruchamianego przez głównego agenta Claude Code w celu przeszukiwania kodu źródłowego. Wykonuje ukierunkowane wyszukiwania plików i treści przy użyciu narzędzi takich jak Glob, Grep i Read, a następnie zwraca wyniki do agenta nadrzędnego.

## Zachowanie

- Uruchamiany automatycznie gdy główny agent musi przeszukać lub eksplorować kod źródłowy
- Działa w izolowanym kontekście z dostępem tylko do odczytu
- Używa Glob do dopasowywania wzorców plików, Grep do wyszukiwania treści i Read do inspekcji plików
- Zwraca wyniki wyszukiwania do agenta nadrzędnego w celu dalszego przetwarzania

## Kiedy się pojawia

Pod-agenty Search pojawiają się zazwyczaj gdy:

1. Główny agent musi znaleźć określone pliki, funkcje lub wzorce kodu
2. Użytkownik prosi o szeroką eksplorację kodu źródłowego
3. Agent bada zależności, odwołania lub wzorce użycia
