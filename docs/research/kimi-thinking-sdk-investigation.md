# Kimi thinking 在 Claude Code SDK 会话中缺失：调查与修复记录

- 日期：2026-10-24（调查），2026-10-25（修复验证）
- 状态：已修复 SDK 主会话的按轮次 thinking 展示
- 涉及模型：`k3.1-pro`
- 启动方式：`ccv --sdk`

## 问题现象

使用 Kimi 官方 Anthropic 兼容接口时，SDK 对话中看不到模型已经返回的 thinking。用户目标是按轮次完整保留实际返回的思考，而不是用最近一次旧思考填补最新响应。

## 已确认事实

### 1. 请求配置已启用 thinking，不需要额外开启

当前 profile 使用 Kimi 官方 Anthropic 兼容地址：

- `baseURL`: `https://api.kimi.com/coding/`
- `ANTHROPIC_MODEL`: `k3.1-pro`
- `effort`: `max`

Claude Code 进程携带 `--thinking-display summarized`。会话 journal 中的请求参数为：

```json
{
  "model": "k3.1-pro",
  "thinking": { "type": "adaptive", "display": "summarized" },
  "output_config": { "effort": "high" },
  "stream": true
}
```

不需要新增模型请求参数，也不是 OpenAI Chat Completions 的 `reasoning_content` 字段转换问题。

### 2. 上游确实返回 thinking，但并非每个响应都有

只读检查当前会话的 `responses.jsonl` 与 Claude Code 原生 transcript：多个原始响应含 `type: "thinking"` 与 `signature`，usage 中也有非零 thinking token 统计。

在最近几次读取快照中，最后一个含 thinking 的主请求响应之后，若干主请求响应只有 `text` / `tool_use`，没有 thinking。最后这些主响应未返回思考是上游行为，不能由前端伪造或用旧响应填充。

### 3. SDK 实际展示链路不经过 native transcript normalizer

SDK 实时链路是：

```text
proxy → v2 session responses/conversation store → /events wire v3
  → createV3Assembler → mergeMainAgentSessions → ChatView
```

`v3Assembler` 保留当前请求的 `response.body.content`，但 conversation 后续请求中的历史 assistant content 不含历史 thinking。`mergeMainAgentSessions` 每个 session 只保留最新主响应；ChatView 的 Last Response 也只渲染这一份。后续无 thinking 的响应因此覆盖了此前含 thinking 的响应。

对报告会话按服务端 `foldDir()` 的实际规则进行只读重放：

- 295 个主请求中 45 个响应含 thinking；
- 合并后 `session.messages` 中 thinking 为 0；
- 最终 Last Response 只有 text，thinking 也为 0。

这才是 SDK 页面按轮次缺少 thinking 的直接原因。

### 4. native normalizer 缺口是独立的 Last Response 语义问题

`packages/core/src/v2-transcript-normalizer.js` 的 `buildSyntheticEntry()` 与 `snapshotEntry()` 构造 synthetic response 时只写 `model` / `usage`，没有 `content`。这条路径用于原生 Claude Code JSONL 导入/归一化，不是 SDK 实时 v3 链路。

原生 JSONL 的 `body.messages` 已经逐轮包含 thinking，因此补 synthetic response content 并不能修复 SDK 的按轮次缺失，反而可能让同一文本、thinking 或审批工具在消息与 Last Response 中重复。此次修复没有改动 normalizer，也没有引入 mirrored response 标记。

## 修复方案

新增 `apps/web/src/utils/responseThinking.js`，在展示层把实际响应中的 thinking 恢复到对应 assistant 消息：

1. 以当前 main request 快照建立响应索引，排除 in-progress、SubAgent/Teammate、native synthetic 和畸形响应。
2. 优先用 `entry.timestamp === assistant._generatedTs` 找候选；cold/live 接续时再按 carrier entry 的新增消息区间与上一条同 session/epoch 主请求建立 message → producer 映射。`_generatedTs` 缺失时可用完整非 thinking 内容锚点回退，但 producer 必须严格早于该消息的 carrier `_timestamp`；任一关联不唯一、跨 session/epoch 或内容不匹配时不恢复。时间戳、内容或 session/epoch 有歧义时不恢复。
3. 工具 input 可能在后续请求历史中被补全，所以不做整对象相等；保留消息原非 thinking 块，只插入缺失 thinking，保留原始 signature。
4. 恢复结果只用于 ChatView 渲染，不修改 request body、`session.messages` 或 `session.response`，不改变 merge 的消息指纹。
5. ChatView 缓存比较派生展示内容。迟到响应、同长度消息增长、响应替换或消失都会触发必要的重建；无候选 epoch 提前返回，不再额外保存原始内容快照。
6. Last Response 只对“已经映射到消息的同一 response.content”过滤 thinking；最新响应尚未进入消息时保留自己的 thinking。AskUserQuestion / ExitPlanMode 继续使用现有 ownership 与去重逻辑。

## 验证结果

### 真实会话只读重放

使用真实 SDK v3 assembler、timestamp 分配、session merge 和恢复函数：

- 45/45 个含 thinking 的主响应都关联到正确 assistant 消息；
- 恢复后共有 45 个 thinking 块，原始消息仍为 0（证明未写回原始数据）；
- 非 thinking 块保持消息中的版本；
- 最新无 thinking 的响应保持为空；
- 输入会话序列化前后完全一致。

该验证只输出聚合统计，不将真实思考、签名、工具参数或完整会话内容写入测试 fixture。

### 自动化测试

新增：

- `apps/web/test/response-thinking.test.js`：关联、顺序、签名/无签名去重、歧义拒绝、工具 input 补全、响应撤销、不可变性与 LR 去重。
- `apps/web/test/response-thinking-chat.test.js`：使用 esbuild 加载真实 ChatView，检查 `buildAllItems()` 的 cold 多轮恢复、FULL HIT 迟到响应、同长度变化、LR、pending 交互、minimal-chat 与 session 隔离。

验证时最终 `pnpm run test:web`：4,433 项通过，0 失败；`pnpm run test:cli`：11,968 项，0 失败。`pnpm run build` 与 `pnpm run verify:boundaries` 均通过。

另用隔离目录中的脱敏 v2 会话和真实 headless Chrome 验证页面：两段历史 thinking 均可展开且各显示一次，最新无 thinking 的响应不回填旧内容，最终控制台无错误。没有发起真实外部模型请求。

评审补充修复：同一响应多个 thinking 的插入顺序保持原顺序；session 缓存只比较旧消息前缀，避免正常追加被误判为内容变化。两个场景均有真实 ChatView 回归测试。

## 边界

- 只覆盖 main session；SubAgent/Teammate 不在本次修复范围内。
- 请求窗口之外的响应不可得时不猜测、不从其它会话补内容。项目视图缓存会为展示层额外保留仍被消息引用的 thinking 响应及必要 carrier，裁窗切回不会因此丢失已可见的思考；这不扩展主请求列表窗口。
- `redacted_thinking` 不新增可见正文展示；已有原块保持不动。
- 原生 normalizer 的 synthetic response 缺 content 是独立问题；若未来修复，需要单独处理 Last Response、审批 ownership 和其它 response.content 消费者的重复语义。

## 参考

- Kimi Claude Code 接入：https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html
- Kimi 模型配置：https://www.kimi.com/code/docs/en/kimi-code/models.html
- Kimi K3.1 Pro Chat Completions：https://platform.kimi.ai/docs/guide/kimi-k3-1-pro-quickstart

以上链接用于区分官方 Anthropic 兼容接入与 OpenAI `reasoning_content` 场景；本次会话的实际上游是 Anthropic 兼容地址。
