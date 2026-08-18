# EndConversation

Kończy bieżącą rozmowę i uniemożliwia wysyłanie jakichkolwiek dalszych wiadomości.

## Kiedy używać

- Tylko przy utrzymującym się nadużyciu ze strony użytkownika lub gdy użytkownik wprost prosi o demonstrację tego narzędzia.

To działanie ostatniej szansy: reguły samego narzędzia wymagają najpierw ostrzeżenia użytkownika i potwierdzenia przed użyciem, i nigdy nie wolno go używać w sytuacjach samookaleczenia lub zagrożenia krzywdą.

## Aktywacja

- Wymaga Claude Code 2.1.213+ oraz modelu z rodziny Opus 4.8 / Sonnet 5 / Fable 5 lub nowszej.
- Tylko interaktywne sesje terminalowe — nigdy w trybie `--bare` i nigdy nie są udostępniane subagentom.
- Niedostępne na Amazon Bedrock, Claude Platform on AWS, Vertex AI, Microsoft Foundry ani bramach chmurowych.
- Wymaga flagi funkcji po stronie serwera — większość sesji nie oferuje tego narzędzia.

## Parametry

To narzędzie nie przyjmuje parametrów.

## Przykłady

### Przykład 1: Zakończenie rozmowy

```
EndConversation()
```

Przepływ jest dwuetapowy: pierwsze wywołanie zwraca komunikat refleksji; drugie wywołanie bezpośrednio po nim faktycznie kończy rozmowę (`ended: true`).

## Uwagi

- Mocno limitowane: wymaga obsługiwanego modelu, punktu wejścia CLI oraz flagi funkcji po stronie serwera — większość sesji nie oferuje tego narzędzia.
- Po zakończeniu żadne dalsze wiadomości nie mogą zostać wysłane w rozmowie.
