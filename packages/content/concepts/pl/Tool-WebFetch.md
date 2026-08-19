# WebFetch

Pobiera zawartość publicznej strony internetowej, konwertuje HTML na Markdown i uruchamia mały model pomocniczy na wyniku, używając prompta w języku naturalnym, aby wyciągnąć potrzebne informacje.

## Kiedy używać

- Odczytywanie publicznej strony dokumentacji, wpisu na blogu lub RFC przywołanego w rozmowie.
- Wyciąganie konkretnego faktu, fragmentu kodu lub tabeli z znanego URL bez ładowania całej strony do kontekstu.
- Podsumowywanie notatek wydań lub changelogów z otwartego zasobu webowego.
- Sprawdzanie publicznego odniesienia API biblioteki, gdy źródło nie jest w lokalnym repozytorium.
- Śledzenie linku, który użytkownik wkleił do czatu, aby odpowiedzieć na pytanie uzupełniające.

## Parametry

- `url` (string, wymagany): W pełni uformowany bezwzględny URL. Zwykły `http://` jest automatycznie uaktualniany do `https://`.
- `prompt` (string, wymagany): Instrukcja przekazywana do małego modelu ekstrakcyjnego. Opisz dokładnie, co wyciągnąć ze strony, np. "list all exported functions" lub "return the minimum supported Node version".

## Przykłady

### Przykład 1: Wyciągnij domyślną wartość konfiguracji

```
WebFetch(
  url="https://vitejs.dev/config/server-options.html",
  prompt="What is the default value of server.port and can it be a string?"
)
```

Narzędzie pobiera stronę dokumentacji Vite, konwertuje ją na Markdown i zwraca krótką odpowiedź, np. "Default is `5173`; accepts a number only."

### Przykład 2: Podsumuj sekcję changelogu

```
WebFetch(
  url="https://nodejs.org/en/blog/release/v20.11.0",
  prompt="List the security fixes included in this release as bullet points."
)
```

Przydatne, gdy użytkownik pyta "co zmieniło się w Node 20.11", a strona wydania jest długa.

## Uwagi

- `WebFetch` zawodzi przy każdym URL wymagającym uwierzytelnienia, ciasteczek lub VPN. Dla Google Docs, Confluence, Jira, prywatnych zasobów GitHub lub wewnętrznych wiki użyj dedykowanego serwera MCP, który zapewnia uwierzytelniony dostęp.
- Dla czegokolwiek hostowanego na GitHubie (PR, problemy, bloby plików, odpowiedzi API) preferuj CLI `gh` przez `Bash` zamiast scrape'owania UI webowego. `gh pr view`, `gh issue view` i `gh api` zwracają ustrukturyzowane dane i działają na prywatnych repozytoriach.
- Wyniki mogą być podsumowane, gdy pobrana strona jest bardzo duża. Jeśli potrzebujesz dokładnego tekstu, zawęź `prompt`, aby poprosić o dosłowny fragment.
- Stosowany jest samoczyszczący się cache na 15 minut na URL. Powtarzające się wywołania tej samej strony podczas jednej sesji są niemal natychmiastowe, ale mogą zwracać nieco przestarzałą zawartość. Jeśli świeżość ma znaczenie, wspomnij o tym w prompcie lub odczekaj cache.
- Jeśli host docelowy wydaje przekierowanie między hostami, narzędzie zwraca nowy URL w specjalnym bloku odpowiedzi i nie podąża za nim automatycznie. Wywołaj ponownie `WebFetch` z celem przekierowania, jeśli nadal chcesz zawartości.
- Prompt jest wykonywany przez mniejszy, szybszy model niż główny asystent. Utrzymuj go wąski i konkretny; złożone wieloetapowe rozumowanie lepiej obsłużyć, czytając samodzielnie surowy Markdown po pobraniu.
- Nigdy nie przekazuj sekretów, tokenów ani identyfikatorów sesji osadzonych w URL — zawartość stron i query stringi odzwierciedlone w wyjściu mogą być logowane przez usługi upstream.
