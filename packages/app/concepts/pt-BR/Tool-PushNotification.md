# PushNotification

Envia uma notificação na área de trabalho a partir da sessão atual do Claude Code. Se o Remote Control estiver conectado, a notificação também é enviada ao telefone do usuário, trazendo sua atenção de volta à sessão — independentemente do que estiver fazendo.

## Quando usar

- Uma tarefa de longa duração foi concluída enquanto o usuário provavelmente estava longe do terminal
- Uma compilação, execução de testes ou implantação foi concluída e o resultado está pronto para revisão
- Foi atingido um ponto de decisão que requer a participação do usuário antes de continuar
- Surgiu um erro ou bloqueio que não pode ser resolvido de forma autônoma
- O usuário solicitou explicitamente ser notificado quando uma tarefa ou condição específica for atendida

## Quando não usar

Não envie uma notificação para atualizações de progresso rotineiras durante uma tarefa, nem para confirmar que respondeu algo que o usuário claramente acabou de perguntar e está aguardando. Não notifique quando uma tarefa curta é concluída — se o usuário acabou de enviá-la e está esperando, a notificação não agrega valor e corrói a confiança nas notificações futuras. Incline-se fortemente para não enviar.

## Ativação

- Desativado por padrão (feature flag do lado do servidor).
- A entrega roda através da infraestrutura hospedada pela Anthropic — não disponível no Amazon Bedrock, no Claude Platform on AWS, no Google Cloud ou no Microsoft Foundry.
- Push para o telefone adicionalmente requer um cliente de Remote Control conectado.

## Parâmetros

- `message` (string, obrigatório): o corpo da notificação. Mantenha abaixo de 200 caracteres; sistemas operacionais móveis truncam strings mais longas. Comece com o que o usuário agiria: "build failed: 2 auth tests" é mais útil do que "task complete".
- `status` (string, obrigatório): sempre definido como `"proactive"`. Este é um marcador fixo e não muda.

## Exemplos

### Exemplo 1: notificar ao concluir uma análise longa

Uma auditoria de dependências em todo o repositório foi solicitada e levou vários minutos. O usuário se afastou. Quando o relatório estiver pronto:

```
message: "Auditoria de dependências concluída: 3 CVEs críticos em lodash, axios, jsonwebtoken. Relatório: audit-report.txt"
status: "proactive"
```

### Exemplo 2: sinalizar um ponto de decisão durante trabalho autônomo

Durante uma refatoração de várias etapas, descobre-se que dois módulos têm interfaces conflitantes e não podem ser mesclados sem uma decisão de design:

```
message: "Refatoração pausada: AuthService e UserService têm interfaces de token conflitantes. Sua decisão é necessária para continuar."
status: "proactive"
```

## Observações

- Incline-se fortemente para **não** enviar. A notificação interrompe o usuário independentemente do que ele estiver fazendo. Trate-a como um custo que precisa ser justificado pelo valor da informação.
- Comece com conteúdo acionável. As primeiras palavras devem dizer ao usuário o que aconteceu e o que, se houver algo, ele precisa fazer — não uma etiqueta de status genérica.
- Mantenha `message` abaixo de 200 caracteres. Sistemas operacionais móveis truncarão strings mais longas, cortando a parte mais importante se ela aparecer no final.
- Se o resultado indicar que o push não foi enviado porque o Remote Control não está conectado, esse é o comportamento esperado. Nenhuma nova tentativa ou ação adicional é necessária; a notificação local da área de trabalho ainda é disparada.
- Evite spam de notificações. Se notificações forem enviadas com frequência para eventos menores, o usuário começará a ignorá-las. Reserve essa ferramenta para momentos em que haja chance real de o usuário ter se afastado e queira saber o resultado agora.
