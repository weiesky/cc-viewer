# Artifact

Renderuj plik HTML lub Markdown na Artifact — prywatną stronę internetową hostowaną na claude.ai, którą użytkownik może otworzyć w przeglądarce i później wybrać do udostępnienia. Używaj, gdy komunikacja wizualna jest lepsza niż tekst terminala.

## Kiedy używać

- Publikowanie rezultatu wizualnego: raportu, pulpitu nawigacyjnego, notatki badania błędów lub makiety interfejsu
- Aktualizacja wcześniej opublikowanej strony w tym samym miejscu (ta sama ścieżka pliku ponownie wdrażana na ten sam adres URL)
- Wyświetlanie istniejących artefaktów użytkownika w celu znalezienia artefaktu z wcześniejszej sesji (`action: "list"`)
- **Nie** do zawartości, która musi pozostać lokalna, zwykłych odpowiedzi tekstowych ani niczego wymagającego zasobów sieciowych w czasie wyświetlania — ścisły CSP blokuje wszystkie hosty zewnętrzne

## Aktywacja

- Wymaga planu Pro, Max, Team lub Enterprise z zalogowaniem na claude.ai (`/login`).
- Tylko Anthropic API — niedostępne na Amazon Bedrock, Google Cloud i Microsoft Foundry.
- Wymaga Claude Code ≥ 2.1.183 lub aplikacji Desktop ≥ 1.13576.0.
- Wyłącz przez ustawienie `disableArtifact` lub `CLAUDE_CODE_DISABLE_ARTIFACT=1`.

## Parametry

- `file_path` (ciąg znaków): Ścieżka do pliku `.html` lub `.md` do renderowania. Plik jest zawinięty w szkielet dokumentu podczas publikacji, więc pisz zawartość strony bezpośrednio — bez tagów `<!DOCTYPE>`, `<html>`, `<head>` ani `<body>`. Ta sama ścieżka → ten sam adres URL podczas ponownego wdrożenia; inna ścieżka żąda nowego adresu URL.
- `favicon` (ciąg znaków, wymagane do publikacji): Jeden lub dwa emoji użyte jako ikona karty przeglądarki (np. `"📊"`). Tylko emoji, brak znaczników. Zachowaj to samo podczas ponownego wdrażania — użytkownicy znajdują kartę po ikonę.
- `description` (ciąg znaków): Podtytuł z jednym zdaniem wyświetlany na karcie galerii artefaktów.
- `url` (ciąg znaków, opcjonalnie): Przekaż adres URL istniejącego artefaktu, aby go zaktualizować w tym samym miejscu z rozmowy, która go nie opublikowała. Bez tego nowa rozmowa zawsze tworzy nowy adres URL.
- `label` (ciąg znaków, opcjonalnie): Krótka, czytelna przez człowieka nazwa wersji (maks 60 znaków) wyświetlana w selektorze wersji.
- `action` (ciąg znaków, opcjonalnie): `"publish"` (domyślnie) lub `"list"` — wyliczaj opublikowane artefakty użytkownika (tytuł, adres URL, ostatnia aktualizacja), opcjonalnie z `limit`.
- `force` (wartość logiczna, opcjonalnie): Zastąp bez sprawdzenia konfliktów. Tylko po 409 z jednoczesnego zapisu, gdy zostanie rozwiązany.

## Uwagi

- **Tylko zawartość samozbieżna.** Ścisły CSP blokuje żądania do dowolnego hosta zewnętrznego — skrypty CDN, zewnętrzne arkusze stylów, obrazy zdalne, fetch/WebSockets. Osadź cały CSS/JS i osadź zasoby jako identyfikatory URI `data:`.
- **Responsywna i świadoma motywu.** Strony renderują się w jasnym lub ciemnym motywie przeglądarki; styluj oba (`prefers-color-scheme` plus przesłonięcie `data-theme` przeglądarki). Szeroka zawartość przewija się wewnątrz własnego kontenera — główna część strony nigdy nie powinna przewijać się w poziomie.
- **Aktualizacja na rozmowach wymaga `url`.** Ponowne wdrożenie tej samej ścieżki pliku zmienia adres URL tylko w rozmowie, która go opublikowała; aby zachować link starszego artefaktu, znajdź jego adres URL za pomocą `action: "list"` i przekaż go jako `url`.
- **Publikowanie to działanie zewnętrzne.** Zawartość wysłana do usługi artefaktów może być buforowana nawet po usunięciu — nie publikuj niczego, co musi pozostać prywatne na maszynie.
- **Czytaj z powrotem za pomocą WebFetch.** Adresy URL artefaktów claude.ai można pobierać za pomocą WebFetch (nie curl, który pobiera powłokę aplikacji).
