# ReportFindings

Relata achados de revisão de código como uma lista tipada e estruturada que a UI hospedeira renderiza nativamente — em vez de imprimá-los como texto de chat.

## Quando usar

- Concluindo uma revisão de código cujas instruções ativas explicitamente dizem para relatar achados com essa ferramenta
- Re-relatando após aplicar correções, quando as instruções de aplicação da revisão o solicitam (cada achado então carrega um `outcome`)
- **Não** para opiniões ad-hoc, respostas ordinárias, ou revisões cujas instruções especificam um formato de output diferente — e nunca lado a lado com um duplicado de texto dos mesmos achados

## Parâmetros

- `findings` (array, obrigatório, máx 32): Os achados verificados, ranqueados pelo mais severo primeiro — um array vazio se nenhum sobreviveu à verificação. Cada achado:
  - `file` (string, obrigatório): Caminho relativo ao repo.
  - `line` (number, opcional): Linha de âncora indexada de 1.
  - `summary` (string, obrigatório): Declaração de uma sentença do defeito.
  - `failure_scenario` (string, obrigatório): Inputs/estado concretos → output errado ou crash.
  - `category` (string, opcional): Slug curto kebab-case, ex. `correctness`, `simplification`, `efficiency`, `test-coverage`.
  - `verdict` (string, opcional): `CONFIRMED` ou `PLAUSIBLE` — definido quando uma passagem de verify rodou; ausente em revisões apenas-inline.
  - `outcome` (string, opcional): APENAS ao re-relatar após correções — `fixed`, `skipped`, ou `no_change_needed`.
- `level` (string, opcional): O nível de esforço que a revisão rodou — `low`, `medium`, `high`, `xhigh`, ou `max`.

## Observações

- **Chame uma vez.** Uma única chamada com a lista completa, verificada, ranqueada-por-severidade — não uma chamada por achado.
- **Vazio é um resultado válido.** Se nenhum achado sobreviveu à verificação, relate um array vazio em vez de padding com achados fracos.
- **Não duplique em texto.** Quando essa ferramenta relata os resultados, os achados não devem também ser impressos como uma mensagem de chat.
- **`outcome` é apenas para re-relatórios.** No primeiro relatório deixe não definido; após uma passagem de apply, defina o que realmente aconteceu com cada achado.
