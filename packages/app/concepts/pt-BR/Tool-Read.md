# Read

Carrega o conteúdo de um único arquivo do sistema de arquivos local. Suporta texto comum, código fonte, imagens, PDFs e notebooks Jupyter, retornando resultados com números de linha começando em 1 no estilo `cat -n`.

## Quando usar

- Ler um arquivo fonte em um caminho conhecido antes de editar ou analisar
- Inspecionar arquivos de configuração, lockfiles, logs ou artefatos gerados
- Visualizar screenshots ou diagramas que o usuário colou na conversa
- Extrair um intervalo específico de páginas de um manual em PDF longo
- Abrir um notebook `.ipynb` para revisar células de código, markdown e outputs de células em conjunto

## Parâmetros

- `file_path` (string, obrigatório): Caminho absoluto do arquivo alvo. Caminhos relativos são rejeitados.
- `offset` (integer, opcional): Número de linha (começando em 1) para começar a ler. Útil para arquivos grandes quando pareado com `limit`.
- `limit` (integer, opcional): Número máximo de linhas a retornar a partir de `offset`. O padrão é 2000 linhas do topo do arquivo quando omitido.
- `pages` (string, opcional): Intervalo de páginas para arquivos PDF, por exemplo `"1-5"`, `"3"` ou `"10-20"`. Obrigatório para PDFs com mais de 10 páginas; máximo de 20 páginas por requisição.

## Exemplos

### Exemplo 1: Ler um arquivo pequeno inteiro
Chame `Read` apenas com `file_path` definido como `/Users/me/project/src/index.ts`. Até 2000 linhas são retornadas com números de linha, o que geralmente é suficiente para contexto de edição.

### Exemplo 2: Paginar por um log longo
Use `offset: 5001` e `limit: 500` em um arquivo de log de muitos milhares de linhas para recuperar uma janela estreita sem desperdiçar tokens de contexto.

### Exemplo 3: Extrair páginas específicas de PDF
Para um PDF de 120 páginas em `/tmp/spec.pdf`, defina `pages: "8-15"` para extrair apenas o capítulo de que você precisa. Omitir `pages` em um PDF grande produz um erro.

### Exemplo 4: Visualizar uma imagem
Passe o caminho absoluto de um screenshot PNG ou JPG. A imagem é renderizada visualmente para que o Claude Code possa raciocinar sobre ela diretamente.

## Observações

- Sempre prefira caminhos absolutos. Se o usuário fornecer um, confie nele como está.
- Linhas com mais de 2000 caracteres são truncadas; trate o conteúdo retornado como possivelmente cortado para dados extremamente largos.
- Lendo múltiplos arquivos independentes? Dispare várias chamadas `Read` na mesma resposta para que rodem em paralelo.
- `Read` não pode listar diretórios. Use uma chamada `Bash` `ls` ou a ferramenta `Glob` em vez disso.
- Ler um arquivo existente, mas vazio retorna um aviso de sistema em vez de bytes do arquivo, então trate esse sinal explicitamente.
- Um `Read` bem-sucedido é necessário antes de você poder usar `Edit` no mesmo arquivo na sessão atual.
