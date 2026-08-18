# SuggestSkills

Renderiza um card de skills avulsas que o usuário pode adicionar (skills que ainda não estão habilitadas), com base em palavras-chave de tópico.

## Quando usar

- O pedido do usuário corresponde a skills que ele não tem habilitadas (`trigger="user_asked"` quando ele pediu, `trigger="proactive"` quando você sugere sem solicitação).

## Parâmetros

- `keywords` (array of strings, obrigatório): Palavras-chave de tópico do pedido do usuário. 1–8 itens, cada um com 1–64 caracteres.
- `contextLabel` (string, opcional): Rótulo curto vinculando a sugestão ao pedido (máximo de 128 caracteres).
- `trigger` (string, opcional): Como esta sugestão começou — `user_asked` ou `proactive`.

## Exemplos

### Exemplo 1: Sugerir skills por tópico

```
SuggestSkills(keywords=["data visualization", "charts"], contextLabel="For building the dashboard", trigger="user_asked")
```

Skills já habilitadas são filtradas do resultado.

## Observações

- Renderiza apenas um card de sugestão — adicionar uma skill acontece out of band; chame `ListSkills` depois para confirmar.
- Desabilitado sob configurações empresariais HIPAA.
