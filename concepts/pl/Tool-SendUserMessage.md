# SendUserMessage

Wysyła wiadomość do użytkownika — główny kanał widocznego wyjścia w sesjach w stylu brief. Znane również pod swoim starszym aliasem `Brief`.

## Kiedy używać

- Odpowiadanie na coś, co użytkownik właśnie powiedział (`status="normal"`).
- Proaktywne pokazywanie czegoś, o co użytkownik nie prosił i co musi teraz zobaczyć — zadanie kończące się pod jego nieobecność, blokada, na którą natrafiłeś, nieproszona aktualizacja stanu (`status="proactive"`).

## Parametry

W trybie brief:

- `message` (string, wymagany): Wiadomość dla użytkownika. Obsługuje formatowanie markdown.
- `attachments` (tablica, opcjonalny): Załączniki pokazywane obok wiadomości. Każdy wpis to albo ścieżka pliku (bezwzględna lub względem katalogu roboczego) dla lokalnie czytelnego pliku, albo wcześniej rozwiązany obiekt `{file_uuid, file_name, size, is_image}` uzyskany z narzędzia urządzenia, takiego jak `attach_file`.
- `status` (string, wymagany): `proactive` dla nieproszonych aktualizacji, których użytkownik potrzebuje teraz; `normal` przy odpowiadaniu użytkownikowi.

W wersjach bez trybu brief dostępny jest tylko `message`.

## Przykłady

### Przykład 1: Proaktywne powiadomienie o ukończeniu

```
SendUserMessage(
  message="The migration finished — 42 files updated, tests green.",
  status="proactive"
)
```

## Uwagi

- Włączone tylko w trybie brief lub przez odpowiednie wdrożenie funkcji; większość interaktywnych sesji CLI rozmawia z użytkownikiem bezpośrednio.
- Używaj `proactive` oszczędnie — jest przeznaczone do rzeczy, które naprawdę wymagają teraz uwagi użytkownika.
