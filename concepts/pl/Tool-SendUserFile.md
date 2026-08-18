# SendUserFile

Wysyła jeden lub więcej plików do użytkownika — wygenerowane artefakty, zrzuty ekranu, raporty — z kontrolą nad tym, jak klient je prezentuje.

## Kiedy używać

- Wygenerowałeś plik, którego użytkownik potrzebuje (raport, obraz, stronę HTML) i chcesz go pokazać, a nie tylko wspomnieć o jego ścieżce.
- Odpowiadanie z załącznikiem (`status="normal"`) lub proaktywne pokazywanie czegoś, o co użytkownik nie prosił, ale co musi teraz zobaczyć (`status="proactive"`).

## Aktywacja

- Dostępne tylko wtedy, gdy podłączony jest klient Remote Control lub sesja działa w zarządzanym środowisku chmurowym (np. Claude Code w przeglądarce).
- Niedostępne na Amazon Bedrock, Google Cloud i Microsoft Foundry.
- Wymaga, aby sesja zezwalała na wysyłanie plików (możliwość bramkowana ustawieniami/funkcjami); nieoferowane w trybie brief.

## Parametry

- `files` (tablica stringów, wymagany): Ścieżki plików (bezwzględne lub względem katalogu roboczego) do wysłania do użytkownika. Zawsze przekazuj tablicę, nawet dla pojedynczego pliku.
- `caption` (string, opcjonalny): Krótki podpis dla pliku/plików.
- `status` (string, wymagany): `proactive`, gdy pokazujesz plik, o który użytkownik nie prosił i który musi teraz zobaczyć — wygenerowany artefakt, ukończony raport; `normal`, gdy odpowiadasz na coś, co użytkownik właśnie powiedział.
- `display` (string, opcjonalny): `render` otwiera plik inline w panelu bocznym (HTML, SVG, Mermaid, obrazy, PDF-y); `attach` pokazuje tylko kartę pobierania (pliki końcowe, które użytkownik zapisze i otworzy gdzie indziej). Pomiń, aby klient zdecydował na podstawie typu pliku.

## Przykłady

### Przykład 1: Dostarczenie wygenerowanego raportu

```
SendUserFile(
  files=["./out/weekly-report.html"],
  caption="Weekly usage report",
  status="proactive",
  display="render"
)
```

## Uwagi

- Wybierz `display="attach"` dla plików, które użytkownik zapisuje i otwiera w innej aplikacji; `render` dla wszystkiego, co powinien obejrzeć od razu.
