# TaskStop

Zatrzymuje działające zadanie w tle — polecenie powłoki, wysłanego agenta lub zdalną sesję — po jego uchwycie czasu wykonania. Użyj, aby odzyskać zasoby, anulować pracę, która nie jest już użyteczna, lub wybrnąć, gdy zadanie utknęło.

## Kiedy używać

- Polecenie powłoki w tle działa dłużej niż oczekiwano i nie potrzebujesz już jego wyniku.
- Lokalny agent wpadł w pętlę lub się zawiesił i trzeba go skrócić.
- Użytkownik zmienił kierunek, a praca w tle dla poprzedniego kierunku powinna zostać porzucona.
- Zdalna sesja zaraz przekroczy limit czasu lub trzyma zasób, którego potrzebujesz.
- Potrzebujesz czystej karty przed rozpoczęciem nowego uruchomienia tego samego zadania.

Preferuj pozostawienie krótkotrwałej pracy w tle, aby zakończyła się sama. `TaskStop` jest dla przypadków, gdy dalsze wykonanie nie ma wartości lub jest aktywnie szkodliwe.

## Parametry

- `task_id` (string, wymagany): Uchwyt czasu wykonania zwrócony, gdy zadanie w tle zostało uruchomione. To ten sam identyfikator akceptowany przez `TaskOutput`, nie `taskId` z listy zadań.

## Przykłady

### Przykład 1

Zatrzymaj wymknięte spod kontroli polecenie powłoki w tle.

```
TaskStop(task_id: "bash_01HXYZ...")
```

Polecenie otrzymuje sygnał terminacji; zbuforowane wyjście dotychczas zapisane pozostaje czytelne pod jego ścieżką wyjściową.

### Przykład 2

Anuluj wysłanego agenta po korekcie kursu przez użytkownika.

```
TaskStop(task_id: "agent_01ABCD...")
```

## Uwagi

- `TaskStop` żąda terminacji; nie gwarantuje natychmiastowego wyłączenia. Dobrze zachowujące się zadania wychodzą szybko, ale proces wykonujący blokujące I/O może chwilę rozwijać stos.
- Zatrzymanie zadania nie usuwa jego wyjścia. Dla zadań powłoki w tle plik wyjściowy na dysku jest zachowany i nadal czytelny przez `Read`. Dla agentów i sesji cokolwiek wyjścia zostało przechwycone przed zatrzymaniem, jest nadal dostępne przez `TaskOutput`.
- Nieznany `task_id` lub zadanie, które już się zakończyło, zwraca błąd lub no-op. Jest to bezpieczne — możesz wywoływać `TaskStop` obronnie bez sprawdzania statusu.
- Jeśli zamierzasz zrestartować tę samą pracę, zatrzymaj stare zadanie przed wysłaniem nowego, aby uniknąć dwóch równoległych uruchomień ścigających się o współdzielone zasoby (pliki, porty, wiersze bazy danych).
- `TaskStop` nie wpływa na wpisy w liście zadań zespołu. Aby anulować śledzone zadanie, zaktualizuj jego status na `deleted` przez `TaskUpdate`.
