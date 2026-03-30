# SubAgent: Search

## Definição

Search é um tipo de sub-agent gerado pelo agente principal do Claude Code para realizar buscas na base de código. Ele executa buscas direcionadas de arquivos e conteúdo usando ferramentas como Glob, Grep e Read, e então retorna os resultados ao agente pai.

## Comportamento

- Gerado automaticamente quando o agente principal precisa buscar ou explorar a base de código
- Executa em um contexto isolado com acesso somente leitura
- Usa Glob para correspondência de padrões de arquivos, Grep para busca de conteúdo e Read para inspeção de arquivos
- Retorna resultados de busca ao agente pai para processamento adicional

## Quando aparece

Sub-agents Search tipicamente aparecem quando:

1. O agente principal precisa encontrar arquivos, funções ou padrões de código específicos
2. Uma exploração ampla da base de código é solicitada pelo usuário
3. O agente está investigando dependências, referências ou padrões de uso
