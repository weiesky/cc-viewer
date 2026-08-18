# SuggestPluginInstall

Renderiza um card inline de instalação de plugin a partir de resultados de `SearchPlugins`, vinculando sugestões de plugins ao pedido do usuário.

## Quando usar

- Uma busca de plugins trouxe à tona plugins que correspondem ao que o usuário está tentando fazer, e você quer oferecê-los para instalação.

## Parâmetros

- `contextLabel` (string, obrigatório): Cabeçalho curto vinculando a sugestão ao pedido do usuário (máximo de 128 caracteres).
- `plugins` (array, obrigatório): Plugins provenientes de resultados de `SearchPlugins` — 1–16 entradas, cada uma com:
  - `pluginId` (string, obrigatório)
  - `pluginName` (string, obrigatório)
  - `description` (string, obrigatório)
  - `skills` (array, opcional): Até 32 entradas `{name, description?}` descrevendo as skills do plugin.

## Exemplos

### Exemplo 1: Oferecer um plugin correspondente

```
SuggestPluginInstall(
  contextLabel="For reviewing pull requests",
  plugins=[{pluginId="pr-toolkit", pluginName="PR Toolkit", description="Review helpers"}]
)
```

O card é renderizado para o usuário; habilitar o plugin acontece out of band. Chame `ListPlugins` em seguida para descobrir o que foi de fato instalado.

## Observações

- Inclua apenas plugins que vieram de resultados de busca — nunca invente entradas de plugin.
- Desabilitado sob configurações empresariais HIPAA.
