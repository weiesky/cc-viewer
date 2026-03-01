# NotebookEdit

## Definition

Erstatter, indsætter eller sletter specifikke celler i en Jupyter notebook (.ipynb-fil).

## Parametre

| Parameter | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `notebook_path` | string | Ja | Absolut sti til notebook-filen |
| `new_source` | string | Ja | Nyt indhold til cellen |
| `cell_id` | string | Nej | ID på cellen der skal redigeres. I indsættelsestilstand indsættes den nye celle efter dette ID |
| `cell_type` | enum | Nej | Celletype: `code` eller `markdown`. Påkrævet i indsættelsestilstand |
| `edit_mode` | enum | Nej | Redigeringstilstand: `replace` (standard), `insert`, `delete` |

## Brugsscenarier

**Egnet til:**
- Ændre kode- eller markdown-celler i en Jupyter notebook
- Tilføje nye celler til en notebook
- Slette celler fra en notebook

## Bemærkninger

- `cell_number` er 0-indekseret
- `insert`-tilstand indsætter en ny celle på den angivne position
- `delete`-tilstand sletter cellen på den angivne position
- Stien skal være absolut

## Betydning i cc-viewer

NotebookEdit-kald vises i requestloggen som `tool_use` content block, der registrerer de specifikke redigeringsoperationer på notebooken.

## Originaltekst

<textarea readonly>Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source. Jupyter notebooks are interactive documents that combine code, text, and visualizations, commonly used for data analysis and scientific computing. The notebook_path parameter must be an absolute path, not a relative path. The cell_number is 0-indexed. Use edit_mode=insert to add a new cell at the index specified by cell_number. Use edit_mode=delete to delete the cell at the index specified by cell_number.</textarea>
