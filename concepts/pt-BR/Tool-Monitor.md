# Monitor

Inicia um monitor em segundo plano que transmite eventos de um script de longa duração. Cada linha da saída padrão torna-se uma notificação — continue trabalhando enquanto os eventos chegam no chat.

## Quando usar

- Acompanhar erros, avisos ou assinaturas de falha em um arquivo de log enquanto um deploy está em execução
- Consultar uma API remota, um PR ou um pipeline de CI a cada 30 segundos para detectar novos eventos de status
- Observar mudanças em um diretório do sistema de arquivos ou na saída de compilação em tempo real
- Aguardar uma condição específica ao longo de muitas iterações (por exemplo, um marco de etapa de treinamento ou o esvaziamento de uma fila)
- **Não** para um simples "aguardar até concluir" — use `Bash` com `run_in_background` para isso; ele emite uma notificação de conclusão quando o processo termina

## Ativação

- Desativado por padrão (feature flag do lado do servidor).
- Indisponível no Amazon Bedrock, no Google Cloud e no Microsoft Foundry.
- Desativado quando `DISABLE_TELEMETRY` ou `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` está definido.
- A origem WebSocket requer Claude Code 2.1.195+.

## Parâmetros

- `command` (string, obrigatório): O comando de shell ou script a ser executado. Cada linha gravada na saída padrão torna-se um evento de notificação separado. O monitor termina quando o processo encerra.
- `description` (string, obrigatório): Um rótulo curto e legível exibido em cada notificação. Seja específico — "erros em deploy.log" é melhor que "observando logs". Este rótulo identifica qual monitor foi acionado.
- `timeout_ms` (número, padrão `300000`, máx `3600000`): Prazo de encerramento forçado em milissegundos. Após essa duração o processo é encerrado. Ignorado quando `persistent: true`.
- `persistent` (booleano, padrão `false`): Quando `true`, o monitor é executado durante toda a sessão sem limite de tempo. Pare-o explicitamente com `TaskStop`.

## Exemplos

### Exemplo 1: Acompanhar um arquivo de log em busca de erros e falhas

Este exemplo cobre todos os estados terminais: marcador de sucesso, traceback, palavras-chave de erro comuns, encerramento por OOM e saída inesperada do processo.

```bash
tail -F /var/log/deploy.log | grep -E --line-buffered \
  "deployed|Traceback|Error|FAILED|assert|Killed|OOM"
```

Use `grep --line-buffered` em cada pipe. Sem ele, o sistema operacional armazena a saída em blocos de 4 KB e os eventos podem ser atrasados por minutos. O padrão de alternância cobre tanto o caminho de sucesso (`deployed`) quanto os caminhos de falha (`Traceback`, `Error`, `FAILED`, `Killed`, `OOM`). Um monitor que observa apenas o marcador de sucesso permanece silencioso durante uma falha — o silêncio é idêntico a "ainda em execução".

### Exemplo 2: Consultar uma API remota a cada 30 segundos

```bash
while true; do
  curl -sf "https://api.example.com/status" || true
  sleep 30
done | grep --line-buffered -E "completed|failed|error"
```

`|| true` impede que uma falha de rede transitória encerre o loop. Intervalos de consulta de 30 segundos ou mais são apropriados para APIs remotas para evitar limites de taxa. Ajuste o padrão grep para capturar tanto respostas de sucesso quanto de erro, de modo que erros do lado da API não sejam mascarados pelo silêncio.

## Observações

- **Sempre use `grep --line-buffered` em pipes.** Sem ele, o buffer do pipe atrasa os eventos por minutos porque o sistema operacional acumula a saída até encher um bloco de 4 KB. `--line-buffered` força um flush após cada linha.
- **O filtro deve cobrir tanto as assinaturas de sucesso quanto as de falha.** Um monitor que observa apenas o marcador de sucesso permanece silencioso em caso de falha, travamento ou saída inesperada. Amplie a alternância: inclua `Error`, `Traceback`, `FAILED`, `Killed`, `OOM` e marcadores similares de estado terminal ao lado da palavra-chave de sucesso.
- **Intervalos de consulta: 30 segundos ou mais para APIs remotas.** Consultas frequentes a serviços externos arriscam erros de limite de taxa ou bloqueios. Para verificações locais de sistema de arquivos ou processos, 0,5–1 segundo é apropriado.
- **Use `persistent: true` para monitores durante toda a sessão.** O `timeout_ms` padrão de 300.000 ms (5 minutos) encerra o processo. Para monitores que devem ser executados até serem parados explicitamente, defina `persistent: true` e chame `TaskStop` quando concluído.
- **Parada automática em caso de flood de eventos.** Cada linha da saída padrão é uma mensagem de conversa. Se o filtro for muito amplo e produzir eventos demais, o monitor é parado automaticamente. Reinicie com um padrão `grep` mais restrito. Linhas que chegam dentro de 200 ms são agrupadas em uma única notificação.
