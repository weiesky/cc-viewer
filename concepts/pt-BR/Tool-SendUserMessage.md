# SendUserMessage

Envia uma mensagem para o usuário — o principal canal de saída visível em sessões em estilo brief. Também conhecido pelo seu alias legado `Brief`.

## Quando usar

- Responder a algo que o usuário acabou de dizer (`status="normal"`).
- Mostrar proativamente algo que o usuário não pediu e precisa ver agora — uma tarefa concluindo enquanto ele está ausente, um bloqueio que você encontrou, uma atualização de status não solicitada (`status="proactive"`).

## Parâmetros

No modo brief:

- `message` (string, obrigatório): A mensagem para o usuário. Suporta formatação markdown.
- `attachments` (array, opcional): Anexos exibidos junto com a mensagem. Cada entrada é um caminho de arquivo (absoluto ou relativo ao cwd) para um arquivo legível localmente, ou um objeto `{file_uuid, file_name, size, is_image}` pré-resolvido obtido de uma ferramenta de dispositivo como `attach_file`.
- `status` (string, obrigatório): `proactive` para atualizações não solicitadas que o usuário precisa agora; `normal` ao responder ao usuário.

Em builds não-brief, apenas `message` está disponível.

## Exemplos

### Exemplo 1: Aviso proativo de conclusão

```
SendUserMessage(
  message="The migration finished — 42 files updated, tests green.",
  status="proactive"
)
```

## Observações

- Habilitado apenas no modo brief ou via o rollout de recurso correspondente; a maioria das sessões CLI interativas fala com o usuário diretamente.
- Use `proactive` com moderação — ele serve para coisas que realmente precisam da atenção do usuário agora.
