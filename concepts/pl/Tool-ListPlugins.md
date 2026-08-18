# ListPlugins

Wyświetla włączone wtyczki claude.ai użytkownika, opcjonalnie filtrowane po słowach kluczowych.

## Kiedy używać

- Musisz wiedzieć, które wtyczki są już włączone — na przykład, aby potwierdzić, co zostało zainstalowane po karcie `SuggestPluginInstall`.
- Użytkownik pyta, jakie ma wtyczki.

## Parametry

- `keywords` (tablica stringów, opcjonalny): Filtruj listę — do 8 elementów, każdy 1–64 znaki. Pomiń, aby wyświetlić wszystko.

## Przykłady

### Przykład 1: Wyświetlenie włączonych wtyczek

```
ListPlugins()
```

### Przykład 2: Filtrowanie po słowie kluczowym

```
ListPlugins(keywords=["figma"])
```

## Uwagi

- Jeśli katalog wtyczek jest nieosiągalny (odmowa dostępu), narzędzie degraduje się do pustej listy z ostrzeżeniem, zamiast zakończyć się błędem.
- Dostępność zależy od typu sesji i wdrożenia funkcji.
