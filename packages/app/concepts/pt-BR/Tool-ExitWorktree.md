# ExitWorktree

Encerra uma sessão de worktree criada anteriormente por `EnterWorktree` e retorna a sessão ao diretório de trabalho original. Esta ferramenta atua exclusivamente sobre worktrees criados por `EnterWorktree` na sessão atual; se nenhuma sessão desse tipo estiver ativa, a chamada não produz efeito.

## Quando usar

- O trabalho em um worktree isolado foi concluído e você deseja retornar ao diretório de trabalho principal.
- Uma tarefa em um worktree de branch de funcionalidade foi finalizada e, após o merge, você quer limpar o branch e o diretório.
- Você deseja preservar o worktree para uso posterior e simplesmente retornar ao diretório original sem excluir nada.
- Você deseja abandonar um branch experimental ou temporário sem deixar artefatos no disco.
- Você precisa iniciar uma nova sessão de `EnterWorktree`, o que exige primeiro encerrar a atual.

## Parâmetros

- `action` (string, obrigatório): `"keep"` mantém o diretório do worktree e o branch no disco para que você possa retornar a eles mais tarde; `"remove"` exclui tanto o diretório quanto o branch, realizando uma saída limpa.
- `discard_changes` (booleano, opcional, padrão `false`): Relevante apenas quando `action` é `"remove"`. Se o worktree contiver arquivos não confirmados ou commits ausentes no branch original, a ferramenta recusará a remoção, a menos que `discard_changes` seja definido como `true`. A resposta de erro lista as alterações específicas para que você possa confirmar com o usuário antes de invocar novamente.

## Exemplos

### Exemplo 1: saída limpa após merge das alterações

Após concluir o trabalho em um worktree e fazer o merge do branch no main, chame `ExitWorktree` com `action: "remove"` para excluir o diretório do worktree e o branch e retornar ao diretório de trabalho original.

```
ExitWorktree(action: "remove")
```

### Exemplo 2: descartar um worktree temporário com código experimental não confirmado

Se um worktree contiver alterações experimentais não confirmadas que devem ser totalmente descartadas, tente primeiro `action: "remove"`. A ferramenta recusará e listará as alterações não confirmadas. Após confirmar com o usuário que as alterações podem ser descartadas, invoque novamente com `discard_changes: true`.

```
ExitWorktree(action: "remove", discard_changes: true)
```

## Observações

- Esta ferramenta atua exclusivamente sobre worktrees criados por `EnterWorktree` na sessão atual. Ela não afetará worktrees criados com `git worktree add`, worktrees de sessões anteriores nem o diretório de trabalho comum se `EnterWorktree` nunca tiver sido chamado — nesses casos a chamada não produz efeito.
- `action: "remove"` é recusado se o worktree tiver alterações não confirmadas ou commits não presentes no branch original, a menos que `discard_changes: true` seja fornecido explicitamente. Confirme sempre com o usuário antes de definir `discard_changes: true`, pois os dados não podem ser recuperados.
- Se uma sessão tmux estiver vinculada ao worktree: no `remove` ela é encerrada; no `keep` continua em execução e seu nome é retornado para que o usuário possa reconectar-se mais tarde.
- Após a conclusão de `ExitWorktree`, `EnterWorktree` pode ser chamado novamente para iniciar uma nova sessão de worktree.
