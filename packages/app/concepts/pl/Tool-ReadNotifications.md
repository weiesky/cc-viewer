# ReadNotifications

Odczytuje powiadomienia zakolejkowane dla asystenta w bieżącej sesji — aktywność GitHub na obserwowanych PR (`github_webhook`), wyzwolenia zaplanowanych wyzwalaczy (`trigger_fire`) oraz wiadomości nadchodzące z innych sesji Claude (`mcp_send_message`).

## Kiedy używać

- Zostałeś powiadomiony, że coś się wydarzyło — obserwowany PR został zaktualizowany, zaplanowany wyzwalacz został wyzwolony, inna sesja wysłała Ci wiadomość — i potrzebujesz faktycznej zawartości.
- Opróżnianie zaległości: duże partie są zwracane w częściach, więc wywołuj narzędzie wielokrotnie, dopóki wynik nie zgłosi 0 `remaining`.

## Parametry

To narzędzie nie przyjmuje parametrów.

## Przykłady

### Przykład 1: Opróżnienie oczekujących powiadomień

```
ReadNotifications()
```

Zwraca zakolejkowane powiadomienia w kolejności od najstarszych. Wynik zawiera licznik `remaining` powiadomień wciąż zakolejkowanych po tym opróżnieniu — wywołaj narzędzie ponownie, aby je odczytać.

## Uwagi

- Opróżnienia są limitowane rozmiarem: kolejne wywołanie zwraca resztę TEJ SAMEJ kolejki (plus wszystko, co nadeszło nowo), a nie tylko nowe powiadomienia. Wywołuj w pętli, dopóki `remaining` nie wyniesie 0.
- Powiadomienia pochodzą z webhooków GitHub na obserwowanych PR, zaplanowanych wyzwalaczy oraz wiadomości z innych sesji Claude; w bieżącej wersji nie ma parametru filtrowania.
