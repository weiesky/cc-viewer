# ProposeGoal

Propõe uma meta de conclusão verificável para a sessão. A meta é mostrada ao usuário em um diálogo de aprovação (por padrão) e, uma vez definida, guia o restante da conversa em direção a um resultado verificável.

## Quando usar

- A sessão tem um estado final concreto que um avaliador poderia verificar a partir da conversa (por exemplo, "all tests in test/auth pass").
- Você quer a aprovação explícita do usuário sobre o que significa "pronto" antes de fazer trabalho substancial.
- As próprias palavras do usuário já declararam o resultado e você quer registrá-lo como a meta da sessão.

## Ativação

- Desativado por padrão (feature flag do lado do servidor).
- Excluído de sessões interativas e em background.
- Desativado pela chave de configuração `modelProposedGoals: "disabled"`.

## Parâmetros

- `condition` (string, obrigatório): A condição de conclusão, escrita de modo que um avaliador separado possa verificá-la a partir da conversa (por exemplo, "all tests in test/auth pass (bun test exits 0)"). No máximo 500 caracteres — o usuário deve conseguir ler a condição inteira no diálogo de aprovação.
- `ask_user` (boolean, opcional): Se deve pedir a aprovação do usuário antes de a meta ser definida. O padrão é true (um diálogo de aprovação é exibido). Defina false SOMENTE quando as próprias palavras do usuário nesta conversa declararam esse resultado como o que ele quer; a meta é então definida diretamente com um aviso visível, e o usuário pode limpá-la com `/goal clear`.

## Exemplos

### Exemplo 1: Propor uma meta apoiada em testes

```
ProposeGoal(condition="npm run test exits 0 with the new catalog cases included")
```

O usuário vê a condição em um diálogo de aprovação e pode aceitar, editar ou rejeitar.

### Exemplo 2: Adotar diretamente o resultado declarado pelo usuário

```
ProposeGoal(condition="the login form validates email format and shows an inline error", ask_user=false)
```

Válido apenas porque o usuário declarou explicitamente esse resultado mais cedo na conversa.

## Observações

- Mantenha `condition` curta e objetivamente verificável — metas vagas ("make it better") anulam o propósito.
- `ask_user=false` é estritamente limitado a resultados que o próprio usuário declarou; qualquer outra coisa deve passar pelo diálogo de aprovação.
