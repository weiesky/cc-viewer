# EndConversation

Encerra a conversa atual e impede que novas mensagens sejam enviadas.

## Quando usar

- Somente para abuso sustentado do usuário, ou quando o usuário pede explicitamente uma demonstração desta ferramenta.

Esta é uma ação de último recurso: as próprias regras da ferramenta exigem avisar o usuário primeiro e confirmar antes do uso, e ela nunca deve ser usada em situações de autoagressão ou relacionadas a danos.

## Parâmetros

Esta ferramenta não recebe parâmetros.

## Exemplos

### Exemplo 1: Encerrar a conversa

```
EndConversation()
```

O fluxo tem duas etapas: a primeira chamada retorna uma mensagem de reflexão; uma segunda chamada imediatamente após encerra de fato a conversa (`ended: true`).

## Observações

- Fortemente gated: requer um modelo suportado, o entrypoint CLI e uma feature flag do lado do servidor — a maioria das sessões não oferece esta ferramenta.
- Uma vez encerrada, nenhuma mensagem adicional pode ser enviada na conversa.
