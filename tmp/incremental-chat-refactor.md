# 专项：对话增量渲染重构

## 问题背景

### 当前架构缺陷

1. **对话数组全量替换**：每次新 entry（SSE 推送）进来，`mergeMainAgentSessions`（AppBase.jsx:1117）直接用最新 entry 的完整 `messages` 数组替换 session.messages。React 检测到新引用 → 全量重绘所有消息。

2. **时间戳丢失**：每个 entry 根节点有准确的 `timestamp` 字段（JSONL 第一个属性），但因为 session.messages 总是被最后一个 entry 的完整数组替换，所有消息只能拿到最后一个 entry 的时间。历史日志中每条 JSONL 记录都有不同的 timestamp，但前端无法正确分配到各条消息。

3. **客户端开销大**：随着对话变长（几百上千条 messages），每次 SSE 推送都触发全量重绘，性能线性恶化。

### 根因

Claude Code 的每个 API 请求携带**完整的 messages 数组**（包含所有历史消息）。cc-viewer 的 `mergeMainAgentSessions` 每次都用这个完整数组替换 session.messages，导致：
- 引用变化 → React 全量重绘
- 时间信息丢失（只有 entry 级别的时间，不知道哪条消息是哪个 entry 新增的）

## 已验证的关键事实

### JSONL 日志结构
- 每条 JSONL 记录根节点的 `timestamp` 是准确的（ISO 8601，如 `"2026-04-04T16:19:23.603Z"`），且是第一个属性
- 由 `interceptor.js:341` 在 API 请求发出时创建：`const timestamp = new Date().toISOString()`
- 不同 entry 有不同的 timestamp（经实际日志验证，每隔几秒到几分钟一条）

### 当前时间戳分配机制（AppBase.jsx:150-171）
- `_processEntries` 中维护 `timestamps[]` 累积数组，按消息 index 分配 entry.timestamp
- 只给新增消息（`index >= timestamps.length`）分配当前 entry 的时间
- **被 entry-slim 破坏**：slimmed entry 的 `_messageCount` 保留原值（如 1195）但 `messages=[]`，导致 `timestamps.length` 继续增长但不设 `_timestamp`。后续 entry count=2 触发 session reset → `timestamps=[]` → 时间全部丢失

### 增量 SSE 路径（AppBase.jsx:950-956）
- 从 `prevMessages[i]._timestamp` 继承已有时间，新增消息用 entry.timestamp
- 但 `prevMessages` 的时间本身就是错的（全量替换导致），所以继承也是错的

### mergeMainAgentSessions（AppBase.jsx:1094-1122）
- L1117: `{ userId, messages: newMessages, response: newResponse, entryTimestamp }`
- 每次直接替换整个 messages 数组为最新 entry 的完整 messages
- `entryTimestamp` 字段已存在于 session 对象上（是最后一个 entry 的时间）

### ChatView 消费时间的方式
- `ChatView.jsx:725`: `const ts = msg._timestamp || null`
- `ChatView.jsx:726`: `const reqIdx = ts ? tsToIndex[ts] : undefined` — 用 timestamp 查 request index
- `ChatView.jsx:864-865`: `tsToIndex[req.timestamp] = i` — 构建 entry.timestamp → request index 映射
- 时间戳除了显示，还用于消息→报文的跳转关联

### _timestamp 的所有消费方
| 文件 | 行号 | 用途 |
|------|------|------|
| `ChatView.jsx` | 725 | 显示时间 + 查 tsToIndex |
| `ChatView.jsx` | 988 | 取下一个 session 第一条消息时间（session 分割） |
| `ContextTab.jsx` | 142-143 | 显示 user/assistant 消息时间 |
| `teamModalBuilder.js` | 37, 47 | 按时间范围过滤消息 |

### delta 重建（lib/delta-reconstructor.js）
- checkpoint entry: `accumulated = [...msgs]`（重置）
- delta entry: `accumulated = [...accumulated, ...msgs]`，`entry.body.messages = accumulated`
- 重建后每个 entry 的 messages 是完整数组，但 message 对象**不是**共享引用（spread 浅拷贝数组，但 JSON.parse 后每个对象独立）
- delta 重建发生在 entry-slim 之前，`_processEntries` 之前

### entry-slim（src/utils/entry-slim.js）
- 被 slim 的 entry: `messages=[]`, `_messageCount=原始长度`, `_slimmed=true`
- 只有最后一个 mainAgent entry 保留完整 messages
- slim 在 delta 重建之后、`_processEntries` 之前执行

## 重构方案

### 核心思路

**维护一个独立的对话渲染数组，只做增量追加，不做全量替换。**

### 具体设计

1. **增量对话数组**：维护 `sessionMessages[]` 独立数组，不依赖 entry.body.messages
   - 每次新 entry 进来，对比 `entry.body.messages.length` 与当前数组长度
   - 只追加新增的消息（index >= 当前长度的部分）
   - 新增消息标记 `_timestamp = entry.timestamp`

2. **时间戳自然解决**：因为只追加不替换，每条消息在追加时标记当时 entry 的 timestamp，后续不会被覆盖

3. **渲染优化**：React 只需重新渲染新增的消息，已有消息保持稳定引用

### 涉及文件

| 文件 | 改动 |
|------|------|
| `src/AppBase.jsx` | `_processEntries`：基于增量数组分配时间 |
| `src/AppBase.jsx` | `mergeMainAgentSessions`：改为增量追加而非整体替换 |
| `src/AppBase.jsx` | 增量 SSE 路径（`handleEventMessage` 附近）：同步改为增量 |
| `src/components/ChatView.jsx` | `renderSessionMessages`（L663）：消费新的数据结构 |
| `src/components/ChatView.jsx` | Virtuoso data/Footer 绑定：确保增量更新不触发全量重绘 |
| `src/utils/teamModalBuilder.js` | L37, 47：确认 `_timestamp` 兼容 |
| `src/components/ContextTab.jsx` | L142-143：确认 `_timestamp` 兼容 |

### 关键数据流

```
当前：
  entry(SSE) → mergeMainAgentSessions(替换 messages) → setState → 全量重绘

目标：
  entry(SSE) → diff(新增消息) → append 到独立数组(标记 timestamp) → setState → 只重绘新增部分
```

### 需要注意的边界情况

1. **session 切换**：消息数量突然减少（新对话开始），需要 reset 独立数组。判断条件：`count < prevCount * 0.5 && (prevCount - count) > 4`
2. **delta 格式 entry**：delta 重建后 messages 是完整数组，走同样的增量比较逻辑即可
3. **entry-slim**：slimmed entry 的 `messages=[]`，应跳过不参与增量追加
4. **response 对象**：session 需要保持最新的 response（最后一个 entry 的）
5. **tsToIndex 映射**：每条消息的 `_timestamp` 必须等于某个 entry 的 `timestamp` 才能映射到 request index
6. **历史日志加载**：批量加载路径（`load_end` → `_processEntries`）也需要用增量逻辑
7. **message 对象引用稳定**：追加的消息对象在后续 entry 中不应被替换，保持引用不变

### 验证要点

1. 历史日志：每条消息显示正确的 entry 时间（不同轮次有不同时间）
2. 实时对话：新消息有正确时间，旧消息时间不变
3. 性能：长对话（500+ 消息）新消息到达时，不触发全量重绘
4. session 切换：新对话开始时，对话数组正确 reset
5. 点击消息跳转到对应 request：tsToIndex 映射正常
6. teamModalBuilder 时间范围过滤正常
7. ContextTab 时间显示正常
