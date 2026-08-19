# Write

Cria um novo arquivo ou substitui completamente o conteúdo de um existente no sistema de arquivos local. Como substitui tudo no caminho alvo, deve ser reservado para criação genuína ou reescritas completas intencionais.

## Quando usar

- Criar um novo arquivo fonte, teste ou configuração que ainda não existe
- Gerar um fixture, snapshot ou arquivo de dados novo do zero
- Executar uma reescrita completa onde um `Edit` incremental seria mais complexo do que começar do zero
- Emitir um artefato solicitado como schema, migração ou script de build que o usuário explicitamente pediu para você produzir

## Parâmetros

- `file_path` (string, obrigatório): Caminho absoluto do arquivo a gravar. Todos os diretórios pais devem já existir.
- `content` (string, obrigatório): O texto completo a gravar no arquivo. Este se torna o corpo inteiro do arquivo.

## Exemplos

### Exemplo 1: Criar um novo módulo auxiliar
Chame `Write` com `file_path: "/Users/me/app/src/utils/slugify.ts"` e forneça a implementação como `content`. Use isso apenas após verificar que o arquivo ainda não existe.

### Exemplo 2: Regerar um artefato derivado
Depois que a fonte do schema muda, reescreva `/Users/me/app/generated/schema.json` em uma única chamada `Write` usando o JSON recém-gerado como `content`.

### Exemplo 3: Substituir um pequeno arquivo de fixture
Para um fixture de teste descartável onde cada linha muda, `Write` pode ser mais claro do que uma sequência de chamadas `Edit`. Leia o arquivo primeiro, confirme o escopo, depois sobrescreva.

## Observações

- Antes de sobrescrever um arquivo existente, você deve chamar `Read` nele na sessão atual. `Write` se recusa a sobrescrever conteúdo não visto.
- Prefira `Edit` para qualquer mudança que toque apenas parte de um arquivo. `Edit` envia apenas o diff, o que é mais rápido, mais seguro e mais fácil de revisar.
- Não crie proativamente documentação Markdown, `README.md` ou arquivos de changelog a menos que o usuário peça explicitamente.
- Não adicione emoji, texto de marketing ou banners decorativos a menos que o usuário solicite esse estilo.
- Verifique primeiro se o diretório pai existe com uma chamada `Bash` `ls`; `Write` não cria pastas intermediárias.
- Forneça o conteúdo exatamente como você quer que seja persistido; não há templating ou pós-processamento.
