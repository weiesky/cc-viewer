# Body Diff JSON (Comparação Incremental do Corpo da Requisição)

## Contexto

O MainAgent do Claude Code utiliza um mecanismo de envio de contexto completo — cada requisição carrega o histórico completo da conversa, system prompt, definições de ferramentas, etc. Isso significa que, conforme a conversa avança, o corpo da requisição se torna cada vez maior, e visualizar o Body bruto dificulta identificar rapidamente "o que foi adicionado nesta rodada".

O Body Diff JSON foi criado exatamente para resolver esse problema: ele compara automaticamente os bodies de duas requisições MainAgent consecutivas, extraindo a parte incremental, permitindo que você veja claramente o conteúdo efetivamente adicionado nesta requisição.

## Como Funciona

1. **Identificar requisições MainAgent consecutivas**: A requisição atual deve ser do tipo MainAgent, e deve existir uma requisição MainAgent anterior
2. **Comparação campo a campo**: Percorre todos os campos de nível superior do corpo da requisição, ignorando propriedades internas com prefixo `_`
3. **Extração inteligente de diferenças**:
   - Campos adicionados: exibidos diretamente
   - Campos removidos: não exibidos (geralmente não afetam a compreensão)
   - Campos alterados: exibe o valor atual
   - Tratamento especial do array `messages`: exibe apenas as mensagens adicionadas (pois em conversa normal o modo é de adição, as mensagens de prefixo não mudam)
4. **Detecção de redução do corpo**: Se o corpo da requisição atual for menor que o anterior, indica truncamento de contexto ou reset de sessão, e nesse caso uma mensagem informativa é exibida em vez do diff

## Cenário Típico

Em uma rodada normal de conversa, o Body Diff JSON geralmente contém apenas:
- `messages`: 1~2 mensagens adicionadas (a entrada do usuário + a resposta do assistente da rodada anterior)

Se você vir alterações em campos como `system`, `tools`, `model` no diff, significa que houve mudança de configuração nesta rodada, o que frequentemente também é a causa da reconstrução de cache.

## Como Usar

- O Body Diff JSON é exibido no painel de detalhes da requisição MainAgent
- Clique no título para expandir/recolher
- Suporta dois modos de visualização: JSON e Text, além de cópia com um clique
- No canto superior esquerdo em **CC-Viewer → Configurações Globais**, é possível configurar "Expandir Body Diff JSON por padrão"
