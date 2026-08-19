# NotebookEdit

Ændrer en enkelt celle i en Jupyter-notebook (`.ipynb`). Understøtter udskiftning af en celles kilde, indsættelse af en ny celle eller sletning af en eksisterende celle, mens resten af notebookens struktur bevares.

## Hvornår skal den bruges

- Rette eller opdatere en kodecelle i en analyse-notebook uden at omskrive hele filen
- Udskifte en markdown-celle for at forbedre narrativ eller tilføje dokumentation
- Indsætte en ny kode- eller markdown-celle på en kendt position i en eksisterende notebook
- Fjerne en forældet eller ødelagt celle, så nedstrømsceller ikke længere afhænger af den
- Forberede en reproducerbar notebook ved at iterere på celler én ad gangen

## Parametre

- `notebook_path` (string, påkrævet): Absolut sti til `.ipynb`-filen. Relative stier afvises.
- `new_source` (string, påkrævet): Den nye cellekilde. For `replace` og `insert` bliver den cellens krop; for `delete` ignoreres den, men er stadig påkrævet af skemaet.
- `cell_id` (string, valgfri): ID for målcellen. I `replace`- og `delete`-tilstand virker værktøjet på denne celle. I `insert`-tilstand indsættes den nye celle umiddelbart efter cellen med dette ID; udelad det for at indsætte øverst i notebooken.
- `cell_type` (enum, valgfri): Enten `code` eller `markdown`. Påkrævet når `edit_mode` er `insert`. Når det udelades under `replace`, bevares den eksisterende celles type.
- `edit_mode` (enum, valgfri): `replace` (standard), `insert` eller `delete`.

## Eksempler

### Eksempel 1: Udskift en fejlbehæftet kodecelle
Kald `NotebookEdit` med `notebook_path` sat til den absolutte sti, `cell_id` sat til målcellens ID og `new_source` indeholdende den rettede Python-kode. Lad `edit_mode` stå på standardværdien `replace`.

### Eksempel 2: Indsæt en markdown-forklaring
For at tilføje en markdown-celle lige efter en eksisterende `setup`-celle, sæt `edit_mode: "insert"`, `cell_type: "markdown"`, `cell_id` til setup-cellens ID, og læg narrativet i `new_source`.

### Eksempel 3: Slet en forældet celle
Sæt `edit_mode: "delete"` og angiv `cell_id` for den celle, der skal fjernes. Angiv en vilkårlig streng for `new_source`; den anvendes ikke.

## Noter

- Send altid en absolut sti. `NotebookEdit` opløser ikke relative stier mod arbejdsmappen.
- Værktøjet omskriver kun den målrettede celle; eksekveringstal, output og metadata for urelaterede celler forbliver uberørte.
- Indsættelse uden et `cell_id` placerer den nye celle allerførst i notebooken.
- `cell_type` er obligatorisk ved indsættelser. Ved erstatninger skal det udelades, medmindre du eksplicit ønsker at konvertere en kodecelle til markdown eller omvendt.
- For at inspicere celler og få fat i deres ID'er skal du først bruge `Read`-værktøjet på notebooken; den returnerer cellerne med deres indhold og output.
- Brug almindelig `Edit` til almindelige kildefiler; `NotebookEdit` er specifik for `.ipynb`-JSON og forstår dens cellestruktur.
