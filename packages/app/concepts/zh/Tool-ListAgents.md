# ListAgents

列出你可以 `SendMessage` 的 agent：你派生的进程内子 agent、本机上的其他本地 Claude 会话、（当本会话有云端访问权限时）你的云端会话，以及——在连接了 Remote Control 时——你账号下的其他会话。每一行按类别标注。

## 何时使用

- 在给某个对等会话或子 agent 发消息之前，你需要它的精确名称。
- 你想看看当前有哪些会话可从本会话到达。

## 启用方式

- 需要 Claude Code 2.1.224+ 以及跨会话消息（一个服务端功能开关，默认关闭）。
- 跨会话消息在 Amazon Bedrock、Claude Platform on AWS、Google Cloud Agent Platform 和 Microsoft Foundry 上不可用。
- 当设置了 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`、`DISABLE_TELEMETRY`、`DO_NOT_TRACK` 或 `DISABLE_GROWTHBOOK` 时关闭。
- 用 `CLAUDE_CODE_HARBOR_KITE=1` 强制启用。

## 参数

- `channel` (string, 可选)：本构建中不可用；保持不设置。
- `q` (string, 可选)：本构建中不可用；保持不设置。

## 示例

### 示例 1：列出可达的 agent

```
ListAgents()
```

每行打印一个名字——这个名字就是地址。用 `SendMessage({to: "<name>", message: "..."})` 发送，名字按打印的原样复制。仅当裸名字有歧义（两行共用同一名字，或报错要求你消歧）时才附加该行的 ` [ref]`。

## 注意事项

- 只读且并发安全。
- 云端会话能收到你的消息，但暂时还不能回消息——请在它自己的转录中读取其回答。
