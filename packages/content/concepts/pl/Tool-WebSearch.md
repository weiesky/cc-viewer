# WebSearch

Wykonuje wyszukiwanie internetowe na żywo i zwraca posortowane wyniki, których asystent używa do osadzenia swojej odpowiedzi w bieżących informacjach poza granicą wiedzy modelu.

## Kiedy używać

- Odpowiadanie na pytania o bieżące wydarzenia, ostatnie wydania lub najświeższe wiadomości.
- Szukanie najnowszej wersji biblioteki, frameworka lub narzędzia CLI.
- Znajdowanie dokumentacji lub wpisów na blogu, gdy dokładny URL jest nieznany.
- Weryfikowanie faktu, który mógł się zmienić od czasu trenowania modelu.
- Odkrywanie wielu perspektyw na temat przed pobraniem pojedynczej strony za pomocą `WebFetch`.

## Aktywacja

- Dostępność zależy od dostawcy i modelu: dostępne na Anthropic API i Claude Platform on AWS; na Microsoft Foundry wymaga wdrożenia hostowanego przez Anthropic; na Google Cloud działa z modelami Claude 4+.
- Niedostępne na Amazon Bedrock.
- Ogranicz do 200 wywołań na sesję przez `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`.

## Parametry

- `query` (string, wymagany): Zapytanie wyszukiwania. Minimalna długość 2 znaki. Dołącz bieżący rok, gdy pytasz o "najnowsze" lub "ostatnie" informacje, aby wyniki były świeże.
- `allowed_domains` (tablica stringów, opcjonalny): Ogranicza wyniki tylko do tych domen, na przykład `["nodejs.org", "developer.mozilla.org"]`. Przydatne, gdy ufasz konkretnemu źródłu.
- `blocked_domains` (tablica stringów, opcjonalny): Wyklucza wyniki z tych domen. Nie przekazuj tej samej domeny do `allowed_domains` i `blocked_domains`.

## Przykłady

### Przykład 1: Wyszukanie wersji z bieżącym rokiem

```
WebSearch(
  query="React 19 stable release date 2026",
  allowed_domains=["react.dev", "github.com"]
)
```

Zwraca oficjalne ogłoszenia i unika słabej jakości agregatorów.

### Przykład 2: Wyklucz hałaśliwe źródła

```
WebSearch(
  query="kubernetes ingress-nginx CVE April 2026",
  blocked_domains=["pinterest.com", "medium.com"]
)
```

Utrzymuje wyniki skoncentrowane na poradach producentów i trackerach bezpieczeństwa.

## Uwagi

- Gdy używasz `WebSearch` w odpowiedzi, musisz dołączyć sekcję `Sources:` na końcu odpowiedzi, wymieniającą każdy cytowany wynik jako hiperłącze Markdown w formie `[Title](URL)`. To wymaganie twarde, nie opcjonalne.
- `WebSearch` jest dostępny tylko dla użytkowników w Stanach Zjednoczonych. Jeśli narzędzie jest niedostępne w Twoim regionie, użyj `WebFetch` względem znanego URL lub poproś użytkownika, aby wkleił odpowiednią zawartość.
- Każde wywołanie wykonuje wyszukiwanie w pojedynczym round-tripie — nie możesz strumieniować ani paginować. Popraw zapytanie, jeśli pierwszy zbiór wyników jest nietrafny.
- Narzędzie zwraca fragmenty i metadane, a nie pełne zawartości stron. Aby przeczytać konkretny wynik dokładnie, kontynuuj z `WebFetch` używając zwróconego URL.
- Używaj `allowed_domains`, aby wymusić autorytatywne źródła dla pytań wrażliwych na bezpieczeństwo, takich jak CVE lub zgodność, oraz `blocked_domains`, aby odciąć farmy SEO, które kopiują dokumentację.
- Utrzymuj zapytania krótkie i oparte na słowach kluczowych. Pytania w języku naturalnym działają, ale mają tendencję do zwracania konwersacyjnych odpowiedzi, a nie źródeł pierwotnych.
- Nie wymyślaj URL-i na podstawie intuicji wyszukiwania — zawsze uruchom wyszukiwanie i cytuj to, co narzędzie faktycznie zwróciło.
