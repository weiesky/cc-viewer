# SendMessage

## Definição

Envia mensagens entre agents dentro de uma equipe. Usado para comunicação direta, broadcast e mensagens de protocolo (solicitações/respostas de encerramento, aprovação de planos).

## Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `to` | string | Sim | Destinatário: nome do integrante, ou `"*"` para broadcast a todos |
| `message` | string / object | Sim | Mensagem de texto ou objeto de protocolo estruturado |
| `summary` | string | Não | Prévia de 5-10 palavras exibida na interface |

## Tipos de mensagem

### Texto simples
Mensagens diretas entre integrantes para coordenação, atualizações de status e discussões sobre tarefas.

### Solicitação de encerramento
Solicita que um integrante encerre de forma ordenada: `{ type: "shutdown_request", reason: "..." }`

### Resposta de encerramento
O integrante aprova ou rejeita o encerramento: `{ type: "shutdown_response", approve: true/false }`

### Resposta de aprovação de plano
Aprova ou rejeita o plano de um integrante: `{ type: "plan_approval_response", approve: true/false }`

## Broadcast vs. Direto

- **Direto** (`to: "nome-do-integrante"`): Enviar a um integrante específico — preferido para a maioria das comunicações
- **Broadcast** (`to: "*"`): Enviar a todos os integrantes — usar com moderação, apenas para anúncios críticos em nível de equipe

## Ferramentas relacionadas

| Ferramenta | Finalidade |
|------------|------------|
| `TeamCreate` | Criar uma nova equipe |
| `TeamDelete` | Remover equipe ao concluir |
| `Agent` | Iniciar integrantes que entram na equipe |
| `TaskCreate` / `TaskUpdate` / `TaskList` | Gerenciar a lista de tarefas compartilhada |
