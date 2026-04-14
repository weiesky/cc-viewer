# UltraPlan — A Máquina de Desejos Definitiva

## O que é UltraPlan

UltraPlan é a **implementação localizada** do cc-viewer para o comando nativo `/ultraplan` do Claude Code. Ele permite que você use todas as capacidades do `/ultraplan` em seu ambiente local **sem precisar iniciar o serviço remoto oficial do Claude**, guiando o Claude Code para realizar tarefas complexas de planejamento e implementação usando **colaboração multiagente**.

Comparado ao modo Plan regular ou Agent Team, o UltraPlan pode:
- Oferece os papéis de **Especialista em código** e **Especialista em pesquisa** adaptados a diferentes tipos de tarefas
- Implantar múltiplos agentes paralelos para explorar a base de código ou realizar pesquisas a partir de diferentes dimensões
- Incorporar pesquisa externa (webSearch) para melhores práticas do setor
- Montar automaticamente uma Equipe de Code Review após a execução do plano para revisão de código
- Formar um ciclo fechado completo **Planejar → Executar → Revisar → Corrigir**

---

## Notas importantes

### 1. UltraPlan não é onipotente
O UltraPlan é uma máquina de desejos mais poderosa, mas isso não significa que todo desejo pode ser realizado. Ele é mais poderoso que o Plan e o Agent Team, mas não pode diretamente "fazer você ganhar dinheiro". Considere uma granularidade de tarefas razoável — divida grandes objetivos em tarefas de tamanho médio executáveis em vez de tentar realizar tudo de uma vez.

### 2. Atualmente mais eficaz para projetos de programação
Os modelos e fluxos de trabalho do UltraPlan são profundamente otimizados para projetos de programação. Outros cenários (documentação, análise de dados, etc.) podem ser tentados, mas você pode querer aguardar adaptações em versões futuras.

### 3. Tempo de execução e requisitos de janela de contexto
- Uma execução bem-sucedida do UltraPlan normalmente leva **30 minutos ou mais**
- Requer que o MainAgent tenha uma janela de contexto grande (modelo Opus com contexto 1M recomendado)
- Se você tem apenas um modelo de 200K, **certifique-se de executar `/clear` no contexto antes de rodar**
- O `/compact` do Claude Code tem desempenho ruim quando a janela de contexto é insuficiente — evite ficar sem espaço
- Manter espaço de contexto suficiente é um pré-requisito crítico para a execução bem-sucedida do UltraPlan

Se você tiver dúvidas ou sugestões sobre o UltraPlan localizado, fique à vontade para abrir [Issues no GitHub](https://github.com/anthropics/claude-code/issues) para discutir e colaborar.

---

## Como funciona

UltraPlan oferece dois papéis de especialista, adaptados a diferentes tipos de tarefas:

### Especialista em código
Um fluxo de trabalho de colaboração multi-agente projetado para projetos de programação:
1. Implantar até 5 agentes paralelos para explorar a base de código simultaneamente (arquitetura, identificação de arquivos, avaliação de riscos, etc.)
2. Opcionalmente implantar um agente de pesquisa para investigar soluções do setor via webSearch
3. Sintetizar todas as descobertas dos agentes em um plano de implementação detalhado
4. Implantar um agente de revisão para examinar o plano sob múltiplas perspectivas
5. Executar o plano após aprovação
6. Montar automaticamente um Code Review Team para validar a qualidade do código após a implementação

### Especialista em pesquisa
Um fluxo de trabalho de colaboração multi-agente projetado para tarefas de pesquisa e análise:
1. Implantar múltiplos agentes paralelos para pesquisar a partir de diferentes dimensões (pesquisas setoriais, artigos acadêmicos, notícias, análise competitiva, etc.)
2. Designar um agente para sintetizar a solução-alvo verificando o rigor e a credibilidade das fontes coletadas
3. Opcionalmente implantar um agente para criar um demo do produto (HTML, Markdown, etc.)
4. Sintetizar todas as descobertas em um plano de implementação abrangente
5. Implantar múltiplos agentes de revisão para examinar o plano sob diferentes papéis e perspectivas
6. Executar o plano após aprovação
