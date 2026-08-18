# ListSkills

Wyświetla włączone skille claude.ai użytkownika, opcjonalnie filtrowane po słowach kluczowych.

## Kiedy używać

- Potrzebujesz autorytatywnej listy aktualnie włączonych skilli — przed wywołaniem któregoś z nich lub aby potwierdzić, co dodała karta `SuggestSkills`.
- Użytkownik pyta, jakie ma skille.

## Aktywacja

- Wymaga uprawnienia dostępu do rejestru wtyczek.
- Wyłączone w środowiskach HIPAA.
- Zawsze dostępne w sesjach zdalnych.

## Parametry

- `keywords` (tablica stringów, opcjonalny): Filtruj listę — do 8 elementów, każdy 1–64 znaki. Pomiń, aby wyświetlić wszystko.

## Przykłady

### Przykład 1: Wyświetlenie włączonych skilli

```
ListSkills()
```

### Przykład 2: Filtrowanie po słowie kluczowym

```
ListSkills(keywords=["review"])
```

## Uwagi

- Jeśli katalog jest nieosiągalny (odmowa dostępu), narzędzie degraduje się do pustej listy z ostrzeżeniem, zamiast zakończyć się błędem.
- To lista *włączonych* skilli; użyj `SuggestSkills`, aby pokazać skille, które użytkownik mógłby dodać.
