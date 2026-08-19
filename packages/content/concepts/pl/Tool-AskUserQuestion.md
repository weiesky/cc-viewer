# AskUserQuestion

Przedstawia użytkownikowi jedno lub więcej ustrukturyzowanych pytań wielokrotnego wyboru w interfejsie czatu, zbiera jego wybory i zwraca je asystentowi — przydatne do ujednoznacznienia intencji bez swobodnej wymiany zdań.

## Kiedy używać

- Żądanie ma wiele rozsądnych interpretacji i asystent potrzebuje, aby użytkownik wybrał jedną przed dalszym działaniem.
- Użytkownik musi wybrać spośród konkretnych opcji (framework, biblioteka, ścieżka pliku, strategia), gdzie odpowiedzi w formie wolnego tekstu byłyby podatne na błędy.
- Chcesz porównać alternatywy obok siebie za pomocą panelu podglądu.
- Kilka powiązanych decyzji można zgrupować w jednym monicie, aby ograniczyć wymianę zdań.
- Plan lub wywołanie narzędzia zależy od konfiguracji, której użytkownik jeszcze nie określił.

## Parametry

- `questions` (tablica, wymagany): Jedno do czterech pytań pokazywanych razem w pojedynczym monicie. Każdy obiekt pytania zawiera:
  - `question` (string, wymagany): Pełna treść pytania, zakończona znakiem zapytania.
  - `header` (string, wymagany): Krótka etykieta (maksymalnie 12 znaków) wyświetlana jako chip nad pytaniem.
  - `options` (tablica, wymagany): Od dwóch do czterech obiektów opcji. Każda opcja ma `label` (1–5 słów), `description` oraz opcjonalny podgląd `markdown`.
  - `multiSelect` (boolean, wymagany): Gdy `true`, użytkownik może wybrać więcej niż jedną opcję.

## Przykłady

### Przykład 1: Wybór jednego frameworka

```
AskUserQuestion(questions=[{
  "header": "Test runner",
  "question": "Which test runner should I configure?",
  "multiSelect": false,
  "options": [
    {"label": "Vitest (Recommended)", "description": "Fast, Vite-native, Jest-compatible API"},
    {"label": "Jest",                  "description": "Mature, broadest plugin ecosystem"},
    {"label": "Node --test",           "description": "Zero dependencies, built in"}
  ]
}])
```

### Przykład 2: Podgląd obok siebie dwóch układów

```
AskUserQuestion(questions=[{
  "header": "Layout",
  "question": "Which dashboard layout do you prefer?",
  "multiSelect": false,
  "options": [
    {"label": "Sidebar",  "description": "Nav on the left", "markdown": "```\n+------+---------+\n| NAV  | CONTENT |\n+------+---------+\n```"},
    {"label": "Top bar",  "description": "Nav across top",  "markdown": "```\n+-----------------+\n|       NAV       |\n+-----------------+\n|     CONTENT     |\n+-----------------+\n```"}
  ]
}])
```

## Uwagi

- Interfejs automatycznie dodaje opcję "Other" z wolnym tekstem do każdego pytania. Nie dodawaj własnej pozycji "Other", "None" ani "Custom" — zduplikuje wbudowaną furtkę.
- Ogranicz każde wywołanie do jednego do czterech pytań, a każde pytanie do dwóch do czterech opcji. Przekroczenie tych granic jest odrzucane przez środowisko.
- Jeśli rekomendujesz konkretną opcję, umieść ją jako pierwszą i dodaj "(Recommended)" do jej etykiety, aby interfejs wyróżnił preferowaną ścieżkę.
- Podglądy przez pole `markdown` są obsługiwane tylko dla pytań jednokrotnego wyboru. Używaj ich do artefaktów wizualnych, takich jak układy ASCII, fragmenty kodu lub diffy konfiguracji — nie do prostych pytań o preferencje, gdzie etykieta i opis wystarczą.
- Gdy jakakolwiek opcja w pytaniu ma wartość `markdown`, interfejs przełącza się na układ obok siebie z listą opcji po lewej i podglądem po prawej.
- Nie używaj `AskUserQuestion`, aby pytać "czy ten plan wygląda dobrze?" — zamiast tego wywołaj `ExitPlanMode`, który istnieje właśnie do akceptacji planu. W trybie planowania unikaj też wspominania o "planie" w treści pytania, ponieważ plan nie jest widoczny dla użytkownika, dopóki nie zostanie uruchomiony `ExitPlanMode`.
- Nie używaj tego narzędzia do pozyskiwania danych wrażliwych lub wprowadzanych swobodnie, takich jak klucze API czy hasła. Zamiast tego zapytaj w czacie.
