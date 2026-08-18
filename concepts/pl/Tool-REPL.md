# REPL

Wykonuje JavaScript w trwałym kontekście vm Node.js wewnątrz sesji. Obsługiwane jest `await` na najwyższym poziomie, a zmienne/funkcje zdefiniowane w jednym wywołaniu pozostają dostępne w późniejszych wywołaniach.

## Kiedy używać

- Szybkie obliczenia, transformacje danych lub przekształcanie JSON, które są łatwiejsze w kodzie niż w jednolinijkowcach w shellu.
- Wieloetapowe skrypty, w których stan pośredni powinien przetrwać między wywołaniami (liczniki, wyniki akumulowane).
- Interaktywne badanie zachowania API lub biblioteki przed zapisaniem go w pliku.

## Parametry

- `code` (string, wymagany): Kod JavaScript do wykonania. Obsługuje `await` na najwyższym poziomie. Stan utrzymuje się między wywołaniami.
- `description` (string, opcjonalny): Jasny, zwięzły opis tego, co robi ten skrypt, w stronie czynnej (5–10 słów), np. "Trace upgrade message to its GrowthBook flag".
- `timeout` (number, opcjonalny): Limit czasu w milisekundach. Domyślnie 30000; maksymalnie 600000.

## Przykłady

### Przykład 1: Obliczenie i ponowne wykorzystanie stanu

```
REPL(code="const counts = new Map(); ['a','b','a'].forEach(k => counts.set(k, (counts.get(k)||0)+1)); counts.get('a')")
```

Zwraca `2`; `counts` pozostaje zdefiniowane dla kolejnych wywołań REPL w tej samej sesji.

### Przykład 2: `await` na najwyższym poziomie z dłuższym limitem czasu

```
REPL(
  code="const res = await fetch('https://example.com/api'); await res.json()",
  description="Fetch example API and parse JSON",
  timeout=60000
)
```

## Uwagi

- Stan jest per sesja: ponowne uruchomienie sesji czyści wszystkie definicje.
- To środowisko JavaScript (Node) — używaj Bash dla poleceń shell, pracy wymagającej systemu plików lub środowisk uruchomieniowych innych niż JS.
- Długo działający kod powinien ustawić jawny `timeout`; domyślne 30 s zabija wszystko, co działa wolniej.
