# RemoteTrigger

Chama a API de gatilhos remotos do claude.ai para gerenciar tarefas agendadas e execuções de gatilho sob demanda. O token OAuth é tratado internamente pela ferramenta e nunca é exposto ao modelo ou ao shell.

## Quando usar

- Gerenciar agentes remotos (gatilhos) no claude.ai, incluindo listagem, inspeção e atualização dos gatilhos existentes
- Criar uma nova tarefa automatizada baseada em cron que execute um agente Claude em um agendamento recorrente
- Disparar um gatilho existente sob demanda sem aguardar a próxima execução agendada
- Listar ou auditar todos os gatilhos atuais para revisar sua configuração e status
- Atualizar configurações de gatilho, como agendamento, carga útil ou descrição, sem precisar recriar o gatilho

## Ativação

- Requer um plano claude.ai Pro, Max, Team ou Enterprise.
- Não disponível no Amazon Bedrock, no Claude Platform on AWS, no Google Cloud ou no Microsoft Foundry.
- Requer feature flags do lado do servidor e as configurações de política `allow_remote_sessions` / `allow_routines`.
- Não é para as próprias sessões remotas.

## Parâmetros

- `action` (string, obrigatório): a operação a executar — um de `list`, `get`, `create`, `update` ou `run`
- `trigger_id` (string, obrigatório para `get`, `update` e `run`): o identificador do gatilho a ser operado; deve corresponder ao padrão `^[\w-]+$` (apenas caracteres de palavra e hífens)
- `body` (object, obrigatório para `create` e `update`; opcional para `run`): a carga útil da requisição enviada à API

## Exemplos

### Exemplo 1: listar todos os gatilhos

```json
{
  "action": "list"
}
```

Chama `GET /v1/code/triggers` e retorna um array JSON de todos os gatilhos associados à conta autenticada.

### Exemplo 2: criar um novo gatilho que é executado toda manhã de dia útil

```json
{
  "action": "create",
  "body": {
    "name": "weekday-morning-report",
    "schedule": "0 8 * * 1-5",
    "description": "Gerar um resumo diário em cada dia útil às 08:00 UTC"
  }
}
```

Chama `POST /v1/code/triggers` com o corpo fornecido e retorna o objeto do gatilho recém-criado, incluindo o `trigger_id` atribuído.

### Exemplo 3: disparar um gatilho sob demanda

```json
{
  "action": "run",
  "trigger_id": "my-report-trigger"
}
```

Chama imediatamente `POST /v1/code/triggers/my-report-trigger/run`, ignorando o horário agendado.

### Exemplo 4: buscar um único gatilho

```json
{
  "action": "get",
  "trigger_id": "my-report-trigger"
}
```

Chama `GET /v1/code/triggers/my-report-trigger` e retorna a configuração completa do gatilho.

## Observações

- O token OAuth é injetado em processo pela ferramenta — nunca copie, cole ou registre tokens manualmente; fazer isso cria um risco de segurança e é desnecessário ao usar esta ferramenta.
- Prefira esta ferramenta em vez de `curl` puro ou outros clientes HTTP para todas as chamadas à API de gatilhos; o uso direto de HTTP ignora a injeção segura do token e pode expor credenciais.
- A ferramenta retorna a resposta JSON bruta da API; o chamador é responsável por analisar a resposta e tratar os códigos de status de erro.
- O valor de `trigger_id` deve corresponder ao padrão `^[\w-]+$` — apenas caracteres alfanuméricos, sublinhados e hífens são permitidos; espaços ou caracteres especiais farão com que a requisição falhe.
