# SendUserFile

Envia um ou mais arquivos para o usuário — artefatos gerados, screenshots, relatórios — com controle sobre como o client os apresenta.

## Quando usar

- Você produziu um arquivo de que o usuário precisa (um relatório, uma imagem, uma página HTML) e quer mostrá-lo, não apenas mencionar seu caminho.
- Responder com um anexo (`status="normal"`), ou mostrar proativamente algo que o usuário não pediu mas precisa ver agora (`status="proactive"`).

## Parâmetros

- `files` (array of strings, obrigatório): Caminhos de arquivo (absolutos ou relativos ao cwd) a enviar para o usuário. Sempre passe um array, mesmo para um único arquivo.
- `caption` (string, opcional): Legenda curta para o(s) arquivo(s).
- `status` (string, obrigatório): `proactive` ao mostrar um arquivo que o usuário não pediu e precisa ver agora — um artefato gerado, um relatório concluído; `normal` ao responder a algo que o usuário acabou de dizer.
- `display` (string, opcional): `render` abre o arquivo inline no painel lateral (HTML, SVG, Mermaid, imagens, PDFs); `attach` mostra apenas um card de download (entregáveis que o usuário vai salvar e abrir em outro lugar). Omita para deixar o client decidir pelo tipo de arquivo.

## Exemplos

### Exemplo 1: Entregar um relatório gerado

```
SendUserFile(
  files=["./out/weekly-report.html"],
  caption="Weekly usage report",
  status="proactive",
  display="render"
)
```

## Observações

- Requer que a sessão permita o envio de arquivos (uma capacidade gated por settings/recurso); não é oferecido no modo brief.
- Escolha `display="attach"` para arquivos que o usuário salva e abre em outro aplicativo; `render` para qualquer coisa que ele deva olhar imediatamente.
