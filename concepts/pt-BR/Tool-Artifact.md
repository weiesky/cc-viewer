# Artifact

Renderiza um arquivo HTML ou Markdown em um Artifact — uma página web hospedada no claude.ai que é privada por padrão e que o usuário pode abrir em um navegador e posteriormente compartilhar. Use quando comunicação visual é melhor que texto de terminal.

## Quando usar

- Publicando um entregável visual: um relatório, dashboard, investigação de bug, ou mockup de UI
- Atualizando uma página previamente publicada no lugar (mesmo caminho redeploy para a mesma URL)
- Listando os artifacts existentes do usuário para encontrar um de uma sessão anterior (`action: "list"`)
- **Não** para conteúdo que deve permanecer local, respostas em texto plano, ou qualquer coisa que precise de recursos de rede externa no tempo de visualização — um CSP rigoroso bloqueia cada host externo

## Ativação

- Requer um plano Pro, Max, Team ou Enterprise com login no claude.ai (`/login`).
- Somente API da Anthropic — não disponível no Amazon Bedrock, no Google Cloud ou no Microsoft Foundry.
- Requer Claude Code ≥ 2.1.183 ou o app Desktop ≥ 1.13576.0.
- Desative com a configuração `disableArtifact` ou `CLAUDE_CODE_DISABLE_ARTIFACT=1`.

## Parâmetros

- `file_path` (string): Caminho para o arquivo `.html` ou `.md` a renderizar. O arquivo é envolvido em um esqueleto de documento no tempo de publicação, então escreva o conteúdo da página diretamente — sem tags `<!DOCTYPE>`, `<html>`, `<head>`, ou `<body>`. Mesmo caminho → mesma URL no redeploy; um caminho diferente reivindica uma nova URL.
- `favicon` (string, obrigatório para publicar): Um ou dois emoji usados como ícone da guia do navegador (ex. `"📊"`). Somente emoji, sem markup. Mantenha igual entre redeploys — usuários encontram sua guia pelo ícone.
- `description` (string): Um subtítulo de uma sentença mostrado no cartão da galeria de artifacts.
- `url` (string, opcional): Passar a URL de um artifact existente para atualizá-lo no lugar a partir de uma conversa que não o publicou. Sem isso, uma nova conversa sempre emite uma nova URL.
- `label` (string, opcional): Nome de versão curto e legível (máx 60 chars) mostrado no seletor de versão.
- `action` (string, opcional): `"publish"` (padrão) ou `"list"` — enumera os artifacts publicados do usuário (título, URL, última atualização), opcionalmente com `limit`.
- `force` (boolean, opcional): Sobrescreve sem verificação de conflito. Apenas após um 409 de um write concorrente, uma vez reconciliado.

## Observações

- **Somente independente.** Um CSP rigoroso bloqueia requisições para qualquer host externo — scripts de CDN, folhas de estilo externas, imagens remotas, fetch/WebSockets. Inline todo CSS/JS e incorpore assets como URIs `data:`.
- **Responsivo e com suporte a temas.** Páginas renderizam no tema claro ou escuro do visualizador; estilize ambos (`prefers-color-scheme` mais override `data-theme` do visualizador). Conteúdo largo scrolls dentro de seu próprio container — o body da página nunca deve scrollar horizontalmente.
- **Atualizando entre conversas precisa de `url`.** Redeploying o mesmo file_path apenas reutiliza a URL dentro da conversa que o publicou; para manter o link de um artifact mais antigo, encontre sua URL com `action: "list"` e passe como `url`.
- **Publicação é voltada para o exterior.** Conteúdo enviado para o serviço de artifact pode ser cacheado mesmo se deletado depois — não publique qualquer coisa que deva permanecer privada na máquina.
- **Leia de volta com WebFetch.** URLs de artifacts do claude.ai são fetcháveis via WebFetch (não curl, que obtém o app shell).
