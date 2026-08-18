# SuggestPluginInstall

Renderuje wbudowaną kartę instalacji wtyczki na podstawie wyników `SearchPlugins`, wiążąc sugestie wtyczek z żądaniem użytkownika.

## Kiedy używać

- Wyszukiwanie wtyczek pokazało wtyczki pasujące do tego, co użytkownik próbuje zrobić, a Ty chcesz zaoferować je do instalacji.

## Aktywacja

- Tylko wtedy, gdy podłączony jest klient Remote Control lub sesja działa w zarządzanym środowisku chmurowym.
- Wyłączone w konfiguracjach enterprise HIPAA.
- Niedostępne w trybie brief.

## Parametry

- `contextLabel` (string, wymagany): Krótki nagłówek wiążący sugestię z żądaniem użytkownika (maksymalnie 128 znaków).
- `plugins` (tablica, wymagany): Wtyczki pochodzące z wyników `SearchPlugins` — 1–16 wpisów, każdy z:
  - `pluginId` (string, wymagany)
  - `pluginName` (string, wymagany)
  - `description` (string, wymagany)
  - `skills` (tablica, opcjonalny): Do 32 wpisów `{name, description?}` opisujących skille wtyczki.

## Przykłady

### Przykład 1: Zaoferowanie pasującej wtyczki

```
SuggestPluginInstall(
  contextLabel="For reviewing pull requests",
  plugins=[{pluginId="pr-toolkit", pluginName="PR Toolkit", description="Review helpers"}]
)
```

Karta jest renderowana dla użytkownika; włączenie wtyczki odbywa się poza tym przepływem. Wywołaj `ListPlugins` w dalszej części, aby odkryć, co faktycznie zostało zainstalowane.

## Uwagi

- Uwzględniaj tylko wtyczki, które pochodzą z wyników wyszukiwania — nigdy nie wymyślaj wpisów wtyczek.
