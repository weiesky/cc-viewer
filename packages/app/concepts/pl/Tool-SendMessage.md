# SendMessage

Dostarcza wiadomość od jednego członka zespołu do drugiego w ramach aktywnego zespołu lub rozsyła ją do każdego współpracownika naraz. To jedyny kanał, którego współpracownicy mogą słuchać — cokolwiek zostanie zapisane w normalnym wyjściu tekstowym, jest dla nich niewidoczne.

## Kiedy używać

- Przypisywanie zadania lub przekazywanie podproblemu nazwanemu współpracownikowi podczas współpracy zespołowej.
- Prośba o status, częściowe wyniki lub przegląd kodu od innego agenta.
- Rozgłaszanie decyzji, wspólnego ograniczenia lub zapowiedzi wyłączenia do całego zespołu za pomocą `*`.
- Odpowiadanie na monit protokolarny, taki jak prośba o wyłączenie lub prośba o zatwierdzenie planu od lidera zespołu.
- Zamykanie pętli na końcu delegowanego zadania, aby lider mógł oznaczyć element jako ukończony.

## Aktywacja

- Bramkowane tymi samymi warunkami wysyłania wiadomości między sesjami co `ListAgents` (flagi funkcji po stronie serwera, domyślnie wyłączone).
- Współpracownicy dodatkowo wymagają włączonych eksperymentalnych zespołów agentów.

## Parametry

- `to` (string, wymagany): Nazwa `name` docelowego współpracownika zarejestrowanego w zespole lub `*`, aby rozesłać do wszystkich współpracowników naraz.
- `message` (string lub obiekt, wymagany): Zwykły tekst do normalnej komunikacji lub ustrukturyzowany obiekt dla odpowiedzi protokolarnych, takich jak `shutdown_response` i `plan_approval_response`.
- `summary` (string, opcjonalny): Podgląd 5–10 słów wyświetlany w dzienniku aktywności zespołu dla wiadomości tekstowych. Wymagany dla długich wiadomości tekstowych; ignorowany, gdy `message` jest obiektem protokołu.

## Przykłady

### Przykład 1: Bezpośrednie przekazanie zadania

```
SendMessage(
  to="db-lead",
  message="Please audit prisma/schema.prisma and list any model missing createdAt/updatedAt timestamps. Reply when done.",
  summary="Audit schema for missing timestamps"
)
```

### Przykład 2: Rozesłanie wspólnego ograniczenia

```
SendMessage(
  to="*",
  message="Reminder: do not touch files under legacy/ — that subtree is frozen until the migration PR lands.",
  summary="Freeze legacy/ during migration"
)
```

### Przykład 3: Odpowiedź protokolarna

Odpowiedz na prośbę lidera o wyłączenie używając ustrukturyzowanej wiadomości:

```
SendMessage(
  to="leader",
  message={ "type": "shutdown_response", "ready": true, "final_report": "All assigned diff chunks committed on branch refactor-crew/db-lead." }
)
```

### Przykład 4: Odpowiedź na zatwierdzenie planu

```
SendMessage(
  to="leader",
  message={ "type": "plan_approval_response", "approved": true, "notes": "LGTM, but please split step 4 into migration + backfill." }
)
```

## Uwagi

- Twoje zwykłe wyjście tekstowe asystenta NIE jest przekazywane współpracownikom. Jeśli chcesz, aby inny agent coś zobaczył, musi to przejść przez `SendMessage`. To najczęstszy błąd w przepływach zespołowych.
- Rozgłaszanie (`to: "*"`) jest kosztowne — wybudza każdego współpracownika i zużywa jego kontekst. Zarezerwuj je dla ogłoszeń, które faktycznie dotyczą wszystkich. Preferuj ukierunkowane wysyłki.
- Utrzymuj wiadomości zwięzłe i zorientowane na działanie. Uwzględnij ścieżki plików, ograniczenia i oczekiwany format odpowiedzi, których potrzebuje odbiorca; pamiętaj, że nie ma wspólnej pamięci z Tobą.
- Obiekty wiadomości protokolarnych (`shutdown_response`, `plan_approval_response`) mają ustalone kształty. Nie mieszaj pól protokolarnych z wiadomościami tekstowymi ani na odwrót.
- Wiadomości są asynchroniczne. Odbiorca otrzyma Twoją wiadomość w swojej następnej turze; nie zakładaj, że ją przeczytał lub zadziałał na niej, dopóki nie odpowie.
- Dobrze napisane `summary` sprawia, że dziennik aktywności zespołu jest łatwy do skanowania przez lidera — traktuj je jak temat commita.
