# NotebookEdit

Modifiserer en enkelt celle i en Jupyter-notebook (`.ipynb`). Støtter å erstatte en celles kilde, sette inn en ny celle eller slette en eksisterende celle mens resten av notebookens struktur bevares.

## Når skal den brukes

- Fikse eller oppdatere en kodecelle i en analyse-notebook uten å skrive om hele filen
- Bytte ut en markdown-celle for å forbedre narrativ eller legge til dokumentasjon
- Sette inn en ny kode- eller markdown-celle på en kjent posisjon i en eksisterende notebook
- Fjerne en utdatert eller ødelagt celle slik at nedstrøms celler ikke lenger er avhengige av den
- Forberede en reproduserbar notebook ved å iterere på celler én om gangen

## Parametere

- `notebook_path` (string, påkrevd): Absolutt sti til `.ipynb`-filen. Relative stier avvises.
- `new_source` (string, påkrevd): Den nye cellekildekoden. For `replace` og `insert` blir dette cellekroppen; for `delete` ignoreres den, men kreves fortsatt av skjemaet.
- `cell_id` (string, valgfri): ID-en til målcellen. I `replace`- og `delete`-modus virker verktøyet på denne cellen. I `insert`-modus settes den nye cellen inn rett etter cellen med denne ID-en; utelat for å sette inn øverst i notebooken.
- `cell_type` (enum, valgfri): Enten `code` eller `markdown`. Påkrevd når `edit_mode` er `insert`. Når den utelates under `replace` bevares eksisterende celletype.
- `edit_mode` (enum, valgfri): `replace` (standard), `insert` eller `delete`.

## Eksempler

### Eksempel 1: Erstatt en buggy kodecelle
Kall `NotebookEdit` med `notebook_path` satt til absolutt sti, `cell_id` satt til målcellens ID og `new_source` som inneholder korrigert Python-kode. La `edit_mode` stå på standard `replace`.

### Eksempel 2: Sett inn en markdown-forklaring
For å legge til en markdown-celle rett etter en eksisterende `setup`-celle, sett `edit_mode: "insert"`, `cell_type: "markdown"`, `cell_id` til setup-cellens ID, og plasser narrativet i `new_source`.

### Eksempel 3: Slett en foreldet celle
Sett `edit_mode: "delete"` og oppgi `cell_id` for cellen som skal fjernes. Oppgi en hvilken som helst streng for `new_source`; den anvendes ikke.

## Notater

- Send alltid inn en absolutt sti. `NotebookEdit` løser ikke opp relative stier mot arbeidskatalogen.
- Verktøyet omskriver kun den målrettede cellen; kjøringsteller, utdata og metadata for urelaterte celler forblir uberørt.
- Å sette inn uten en `cell_id` plasserer den nye cellen helt i begynnelsen av notebooken.
- `cell_type` er obligatorisk for inserts. For replaces, utelat den med mindre du eksplisitt vil konvertere en kodecelle til markdown eller omvendt.
- For å inspisere celler og hente ID-ene deres, bruk `Read`-verktøyet på notebooken først; det returnerer cellene med innhold og utdata.
- Bruk vanlig `Edit` for vanlige kildefiler; `NotebookEdit` er spesifikk for `.ipynb` JSON og forstår cellestrukturen.
