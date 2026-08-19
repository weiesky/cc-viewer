# SuggestSkills

Renderuje kartę samodzielnych skilli, które użytkownik może dodać (skilli, które nie są jeszcze włączone), na podstawie słów kluczowych tematu.

## Kiedy używać

- Żądanie użytkownika pasuje do skilli, których nie ma włączonych (`trigger="user_asked"`, gdy sam zapytał, `trigger="proactive"`, gdy sugerujesz bez prośby).

## Aktywacja

- Tylko wtedy, gdy podłączony jest klient Remote Control lub sesja działa w zarządzanym środowisku chmurowym.
- Wyłączone w konfiguracjach enterprise HIPAA.
- Niedostępne w trybie brief.

## Parametry

- `keywords` (tablica stringów, wymagany): Słowa kluczowe tematu z żądania użytkownika. 1–8 elementów, każdy 1–64 znaki.
- `contextLabel` (string, opcjonalny): Krótka etykieta wiążąca sugestię z żądaniem (maksymalnie 128 znaków).
- `trigger` (string, opcjonalny): Jak zaczęła się ta sugestia — `user_asked` lub `proactive`.

## Przykłady

### Przykład 1: Sugestia skilli według tematu

```
SuggestSkills(keywords=["data visualization", "charts"], contextLabel="For building the dashboard", trigger="user_asked")
```

Skille już włączone są odfiltrowywane z wyniku.

## Uwagi

- Renderuje tylko kartę sugestii — dodanie skilla odbywa się poza tym przepływem; wywołaj potem `ListSkills`, aby potwierdzić.
