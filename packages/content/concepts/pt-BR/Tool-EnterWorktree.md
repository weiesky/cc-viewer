# EnterWorktree

Cria um worktree Git isolado em uma nova branch, ou coloca a sessão em um worktree existente do repositório atual, para que trabalho paralelo ou experimental possa prosseguir sem tocar no checkout principal.

## Quando usar

- O usuário diz explicitamente "worktree" — por exemplo "start a worktree", "create a worktree" ou "work in a worktree".
- Instruções do projeto em `CLAUDE.md` ou memória persistente direcionam você a usar um worktree para a tarefa atual.
- Você quer continuar uma tarefa que foi previamente configurada como worktree (passe `path` para reentrar nele).
- Múltiplas branches experimentais precisam coexistir em disco sem constantes trocas de checkout.
- Uma tarefa de longa duração deve ser isolada de edições não relacionadas na árvore de trabalho principal.

## Parâmetros

- `name` (string, opcional): Um nome para um novo diretório de worktree. Cada segmento separado por `/` pode conter apenas letras, dígitos, pontos, underscores e hífens; a string completa é limitada a 64 caracteres. Se omitido e `path` também for omitido, um nome aleatório é gerado. Mutuamente exclusivo com `path`.
- `path` (string, opcional): O caminho do sistema de arquivos de um worktree existente do repositório atual para entrar. Deve aparecer em `git worktree list` para este repo; caminhos que não são worktrees registrados do repo atual são rejeitados. Mutuamente exclusivo com `name`.

## Exemplos

### Exemplo 1: Criar um novo worktree com um nome descritivo

```
EnterWorktree(name="feat/okta-sso")
```

Cria `.claude/worktrees/feat/okta-sso` em uma nova branch baseada em `HEAD`, depois muda o diretório de trabalho da sessão para ele. Todas as edições de arquivo e comandos de shell subsequentes operam dentro desse worktree até você sair.

### Exemplo 2: Reentrar em um worktree existente

```
EnterWorktree(path="/Users/me/repo/.claude/worktrees/feat/okta-sso")
```

Retoma o trabalho em um worktree previamente criado. Como você entrou nele via `path`, `ExitWorktree` não o excluirá automaticamente — sair com `action: "keep"` simplesmente retorna ao diretório original.

## Observações

- Não chame `EnterWorktree` a menos que o usuário tenha pedido explicitamente ou as instruções do projeto exijam. Trocas de branch ordinárias ou pedidos de correção de bug devem usar comandos Git normais, não worktrees.
- Quando invocado dentro de um repositório Git, a ferramenta cria um worktree sob `.claude/worktrees/` e registra uma nova branch baseada em `HEAD`. Fora de um repositório Git, ela delega para hooks `WorktreeCreate` / `WorktreeRemove` configurados em `settings.json` para isolamento agnóstico a VCS.
- Apenas uma sessão de worktree está ativa por vez. A ferramenta se recusa a rodar se você já está dentro de uma sessão de worktree; saia primeiro com `ExitWorktree`.
- Use `ExitWorktree` para sair durante a sessão. Se a sessão terminar enquanto ainda estiver em um worktree recém-criado, o usuário é questionado se quer mantê-lo ou removê-lo.
- Worktrees entrados via `path` são considerados externos — `ExitWorktree` com `action: "remove"` não os excluirá. Isso é uma proteção para preservar worktrees que o usuário gerencia manualmente.
- Um novo worktree herda o conteúdo da branch atual, mas tem um diretório de trabalho e index independentes. Mudanças staged e unstaged no checkout principal não são visíveis dentro do worktree.
- Dica de nomenclatura: prefixe com o tipo de trabalho (`feat/`, `fix/`, `spike/`) para que múltiplos worktrees concorrentes sejam fáceis de distinguir em `git worktree list`.
