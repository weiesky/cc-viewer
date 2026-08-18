# cc-viewer Wire Format v2 协议规范

状态：**草案（S0，待评审）** ｜ 上游计划：`docs/refactor/WIRE_FORMAT_V2_PLAN.md` ｜ 取代对象：`docs/WIRE_FORMAT.md`（v1，定稿后标注 superseded，v1 读取能力长期保留）

本文是 v2 存储的唯一权威定义。实现（S2 起）与本文冲突时，先改本文再改代码。

---

## §1 设计原则

1. **写侧保真，读侧物化**：对话文件存 wire 事件（增量切片 + 控制行），不在写路径做任何 merge/逆锚推断——写侧只做一个廉价判定（前缀延伸测试，与 v1 delta 同级）；一切歧义窗口（v1 §3.1/§3.2）原样落盘为 raw 快照事件，由读侧物化器用共享逆锚模块解决。写侧错误可事后在读侧修复；物化写则一错永久。
2. **journal 是唯一定序轴**：所有顺序问题（v1 §3.7 完成序倒置）收归 journal 的**发起序 seq**；对话文件行佩戴 seq 回指，物理落盘序不承载语义。
3. **append-only + 无 fsync 现实下的写序协议**：blob →（flush）→ conversation 行 → journal 行最后落。**硬保证只有 blob 半边**（journal 行绝不引用不存在的 blob——blob 在 journal 行入队前已持久）；conv 半边是尽力而为的批次分组——多请求同批 drain 时（如冷启动暂存队列冲刷），后一请求的 journal 行可能先于其 conv 行落盘，读侧按 §14 容忍暂缺尾部，属纵深防御而非正确性依赖。崩溃产生的只有孤儿（无引用的 blob/conv 行）与暂缺的 conv 尾。
4. **v2 永不影响 v1**：双写期 v2 任何失败走 `reportSwallowed`，v1 路径零感知。双 kill switch：`CCV_WIRE_V2`（写）/`CCV_WIRE_V2_READ`（读）独立。**【1.7.0 已移除】**双写与开关体系随 v1 写入端一并退役（`mode.js`/`wire-v2.json`/`/api/wire-v2-mode` 全部删除），v2 无条件生效；磁盘空间守卫是唯一写入抑制器。

## §2 目录布局

```
LOG_DIR/<project>/sessions/<session_id>/
  meta.json          # 创建时原子写（tmp+rename），此后只追加式改写（见 §3）
  journal.jsonl      # 轴心：req/done 两相事件行，append-only（见 §4）
  responses.jsonl    # 每完成请求一行：response body + headers 等大字段（见 §5）
  conversations/<convKey>/e<N>.jsonl   # wire 事件行（见 §6）
  blobs/sha256-<hex16>.json            # tools/system CAS（见 §7）
  owner.lock         # 运行时活性 sidecar（多窗口隔离，2026-07-17）——非 wire 协议组成
```

- `owner.lock`（`server/lib/v2/session-owner.js`）：`{pid, startedAt}`，MAIN leader 写进程创建/收养目录时 `wx` 原子抢占写入，正常退出/workspace 切换时删除。**不属于 wire 格式**：`readSession`/replay/verify 不读取它，声明有效性 = 持有 pid 存活（`kill(pid,0)`），进程崩溃即自动失效——它只影响"live 归属"判定（live-feed 跟随、冷加载兜底、`-c` 收养候选），历史读取面一律无视。teammate / IM worker / 离线转换器不写此文件。

- `<project>`：与 v1 相同的 project 目录名（`basename(cwd)` 清洗后），v1 平铺 `.jsonl` 与 v2 `sessions/` 子目录**共存于同一 project 目录**，双写期互不干扰。
- `<session_id>`：从 `body.metadata.user_id` 解析出的 UUID（§8）；无法解析时的兜底见 §8.3。
- `<convKey>`：`main` ｜ `sub-<tool_use.id 后 12 字符>`（id 前缀 `toolu_01…` 低熵，尾部高熵）｜ fallback `sub-fp-<8位FNV指纹>`，并行同 prompt 无注册 id 时追加序号 `sub-fp-<fp>-<n>` ｜ `misc`（countTokens 等无对话归属）。**路径组件白名单 `[a-zA-Z0-9._-]`，超界字符替换为 `_`**（防注入，v1 先例 `interceptor.js:353`）。
- `e<N>`：epoch 文件，N 从 0 起；main 对话在 /clear 边界 N+1（§9.4）；sub/misc 恒为 e0。
- 目录创建：session/conv 首写前 `mkdirSync(recursive)` **同步**执行（异步 mkdir 会输给 write queue 的 microtask drain → ENOENT 被吞）。
- 命名消歧：`workflow-live.js` 的 ultraAgent 运行日志也叫 `journal.jsonl`，位于完全不同的路径体系（session 传输目录），与本格式无关。

## §3 meta.json

创建时一次性原子写入（先写 `meta.json.tmp` 再 rename，v1 rotation sentinel 同款手法，杜绝 watcher 读到半截）：

```jsonc
{
  "wireFormat": 2,
  "sessionId": "a9883ab8-…",
  "project": "cc-viewer",
  "instanceId": "12345",          // CCV_INSTANCE_ID（pid），替代 v1 文件名 <pid>__ 前缀的归属职责
  "pid": 12345,
  "startTs": "2026-07-13T05:15:11.570Z",
  "userIdRaw": "…原始 user_id 字符串…",   // 客户端等值边界检测需要原样回放（§11）
  "userIdEncoding": "json" | "delimited", // §8 双编码
  "ccVersion": "2.1.207",        // 尽力从 system 首块 billing header 提取，可空
  "leader": {                     // 仅 teammate 进程写；用于读侧 re-join（§10）
    "sessionId": "…", "agentName": "cr-product", "teamName": "…"
  },
  "im": { "platform": "…", "id": "…" }   // 仅 IM worker 写（S6b 前 IM 固定 v1，本字段预留）
}
```

后续可追加字段（如 `endTs`）采用整文件重写 + rename，频率极低（session 结束/轮转挂点）。

## §4 journal.jsonl —— 轴心

**两相事件行**（append-only，不改写历史行；读侧按 seq 折叠）：

**req 行**（请求发起时，与 v1 `_seq` 同一同步段内构造并入队——这是 §3.7 防复活的关键）：

```jsonc
{
  "ph": "req",
  "seq": 42,                      // session 内单调，发起序（非完成序）
  "rid": "1783918085_ab12cd34e",  // v1 requestId 原值，跨 journal/conversations/responses 关联键
  "ts": "2026-07-13T05:15:11.570Z", // = v1 entry.timestamp（适配器 ${timestamp}|${url} 键的一半）
  "kind": "main" | "sub" | "teammate" | "heartbeat" | "countTokens" | "misc",
  "conv": "main",                 // convKey；heartbeat 无 conv（省略）
  "epoch": 3,                     // conv 的 epoch 号（无 conv 则省略）
  "url": "https://api.anthropic.com/v1/messages?beta=true",
  "method": "POST",
  "model": "claude-fable-5",
  "isStream": true,
  "headers": { …redacted… },      // v1 同款脱敏后 headers（~1KB，DetailPanel 需要）
  "params": { "max_tokens": 32000, "temperature": 1, "metadata": {…}, … },  // body 除 messages/system/tools 外的全部顶层字段整体内联（对齐 headers 模式；空对象/非对象 body 省略。2026-07-16 追加，旧行缺失时读侧回退旧规则）
  "blobs": { "tools": "sha256-a1b2…", "sys": "sha256-c3d4…" },  // 缺失字段省略
  "msgFrom": 903, "msgTo": 905,   // 本事件对应 wire messages 的 [from,to) 计数（物化完整性校验）
  "evt": "append" | "snapshot" | "ctl",  // 对应 conversation 行类型（§6，replace-tail 等控制行为 ctl）；无 conv 写入则省略
  "boundary": "clear" | "compact" | "replace-tail",  // 触发的边界（可省略）
  "proxy": { "profile": "…", "url": "…", "role": "main" | "subagent" | "teammate" }  // proxyProfile/proxyUrl/proxyRole（可省略；role 仅在发生改写时记录，且与 kind 的 main/sub 是不同维度，值域勿混用）
  "agent": { "agentName": "frontend-reviewer" | null, "named": true | false }  // 可选：从请求头 x-claude-code-agent-id 解析的 wire agent 身份（teammate/subagent 请求携带）。named=true 时 agentName 是展示名（前端不再依赖窗口内启发式注册表）；named=false 表示匿名 hex id。旧行缺失时读侧回退（见 server/lib/v2/agent-id.js）
}
```

**done 行**（响应完成/失败时）：

```jsonc
{
  "ph": "done",
  "seq": 42, "rid": "…",
  "ts": "…完成时刻…", "dur": 5230,
  "status": "ok" | "error" | "capture-failed",
  "http": 200,
  "usage": { "in": 12034, "out": 512, "cr": 11800, "cw": 200 },  // 摘要，全量在 responses.jsonl
  "stop": "end_turn"
}
```

- **placeholder 消灭**：v1 的 inProgress placeholder（全量 body 双写）由 req 行取代——零 body。读到 req-without-done 即在途。
- 崩溃语义：只有 req 无 done = 在途或进程死亡；适配器合成 `inProgress:true` 条目（§11）。
- journal 首行：session 建立时写一行 `{"ph":"meta","wireFormat":2,"sessionId":…}` 自描述哨兵（与 meta.json 冗余，允许 journal 单文件自解释；同 v1 rotation-context 首帧原子性要求，随 meta 创建流程一并落盘）。

## §5 responses.jsonl

每完成请求一行：`{ seq, rid, body: <完整 response body>, headers?: <response headers>, statusText?: <HTTP statusText> }`。

- 流式请求：body = `assembleStreamMessage` 组装结果（v1 同源）；组装失败时 `body: {"assembleError": "...", "head": <前1000字符>}`（对应 v1 :1106/:1191 兜底路径）。
- heartbeat/countTokens：同样落一行（体积小、保真）。
- 不去重：response 与下一请求的回显 messages 理论上重复，但 response 含 usage/stop_reason/id 等独有信息，且"最后一条 response 永远不会被回显"，为保真与实现简单不做交叉引用。此项占比小（v1 实测 response 平均 4–6KB）。

## §5a prompts.jsonl —— 展示缓存（可选侧文件,2026-07-14 追加）

会话根目录下的**可选**追加式侧文件,缓存该会话去重后的 user prompts,供日志列表的「概览」列零计算读取。每行 `{ seq, texts: ["…≤100字符…", …] }`,由 V2Writer 在 journal req 行之后写入(main 会话流的 snapshot/append/replace-tail 事件,经 `server/lib/user-prompt-extract.js` 共享提取链过滤系统注入/命令包裹/建议模式);离线转换器走同一写入器,产物天然携带。

- **读者容忍缺失**:replay/verify 的文件白名单(meta/journal/conversations/e\d+.jsonl)不读它;列表读取端(`readPromptsHead`)有界头读(默认 256KB),文件缺失时回退到首行提取。缺失≠损坏——**不因本文件引入 bump `WIRE_FORMAT_VERSION`**(bump 会让读侧版本门拒读全部存量会话)。
- 幂等:写侧内存去重集在会话对象初始化时由现有文件播种,进程重启/`-c` 续接的全量 snapshot 重放不会重复追加;单会话记录上限 2000 条。

## §6 conversations/<convKey>/e<N>.jsonl —— wire 事件行

每行一个事件，两种类型（由写侧的**唯一判定**——前缀延伸测试——决定）：

```jsonc
// append：wire messages 是上一状态的前缀延伸（≥99% 常态；含 messages 完全不变=空切片，不落行）
{ "seq": 42, "rid": "…", "t": "append", "msgs": [ …新增 message 切片… ] }

// snapshot：前缀延伸不成立（v1 §3.1 plan-mode 短窗口 / §3.2 K 尾重叠 / 非 /clear 收缩 / 任何未知形态）
{ "seq": 43, "rid": "…", "t": "snapshot", "msgs": [ …完整 wire messages… ], "reason": "shrunk|tail-mismatch|first" }
// reason 语义：first=对话首事件/进程重启；shrunk=len<prev（含 §3.1 短窗口——不单列 short-window）；tail-mismatch=len>prev 但前缀断裂（§3.2 等）

// 控制行（不携带 msgs）
{ "seq": 44, "rid": "…", "t": "ctl", "op": "replace-tail", "msg": { …新末位 message… } }   // v1 §3.3 in-place replace
{ "seq": 45, "rid": "…", "t": "ctl", "op": "compact", "keep": 2 }                          // v1 §3.5 /compact continuation 标记
```

- **写侧判定规则（穷尽）**：设 conv 上一状态计数 P、末位指纹 F（进程内存态，进程重启后 P=0）。**判定指纹 = v1 的 `fingerprintMsg`（interceptor-core，对 tool_result 含 40 字符内容分量）**，与 v1 Plan C 完全同源——不用客户端共享的 `messageFingerprint`（其 tool_result 仅按 id，同 id 换内容不可见，评审已定级为双写分歧盲区）：
  - `len==P && tailFp==F` → 无事件（journal 仍记 req/done，`evt` 省略）
  - `len==P && tailFp!=F && P>0` → `ctl replace-tail`（v1 :802-808 同判定；实现另要求新旧 tailFp 均非空——空 fp 消息退化为 snapshot，安全偏差）
  - `len>P && messages[P-1] 指纹==F` → `append`（切片 `slice(P)`）
  - 其余一切 → `snapshot`（进程重启首请求也是 snapshot，reason=first）；若命中 compact-continuation 判定（S1 共享谓词）附加一行 `ctl compact`
  - **/clear 判定（S1 共享谓词 isPostClearCheckpoint）优先于以上**：关闭当前 epoch，新开 e<N+1>，首事件为 snapshot(reason=first)，journal 记 `boundary:"clear"`
- messages 切片**原样存 wire 内容**（不含 tools/system——那是 body 级字段，已入 blob）；不注入任何 `_` 字段（per-message 时间戳由读侧用 journal ts 赋予，粒度=事件级，与 v1 客户端位置时间戳机制精度等价）。
- **物化算法（读侧，共享物化器）**：按 seq 升序折叠事件流；append 直接拼接；snapshot 用共享逆锚模块（S1 的 findReverseAnchor）与当前物化态求 merge（v1 客户端 sessionMerge 同款语义）；ctl 按 op 应用。物化结果校验 journal msgTo，不符则标记降级（对应 v1 `_reconstructBroken` 的读侧内部态，**不外泄给客户端**）。

### §6.1 epoch 与进程重启（2026-07-15 修复）

fresh writer(进程重启 / `-c` 接续既有会话目录)的 ConversationStore 会从磁盘**播种 epoch**(取 conv 目录下最大 e<N>),并把首事件写成自包含 snapshot(reason 'first')续在 **e_max** 内——保证跨 epoch 文件的全局 seq 顺序单调(journal seq 本就从盘播种)。修复前 fresh store 恒从 e0 开始,重启后把更新的 seq 追加进旧文件,打破 live 读侧的顺序假设。已知角落:重启首个 wire 若恰为 post-/clear checkpoint,该边界的 epoch 标签滞后一格(wire 真值无损,仅材料化的 epoch 分割可见)。

## §7 blobs/ —— tools/system CAS

- key = `sha256(JSON.stringify(value))` 十六进制**前 16 字符**（session 内碰撞概率可忽略；短 key 减小 journal 体积）。文件内容 = 原始 JSON 值（tools 数组 / system 值）原样。
- 写入：`writeFileSync(tmp, data); fsyncSync? → rename`——blob 是写序协议中唯一加 flush 屏障的环节（journal 行落盘前其引用目标必须持久）。已存在同 key 文件则跳过（天然幂等）。进程内 hash→已写 缓存避免重复 IO。
- **逐请求归属保证**：blob ref 记录在**每条** journal req 行上；适配器按行回填，物化器不做任何"沿用上一条"推断——这是 v1 `entry-slim.js:237` tools 回归的根因规避。tools-diff UI（ContextTab）是本保证的现成回归探测器。

## §8 user_id 双编码解析（identity.js 规范）

wire 上存在两种编码，**解析器与 S8 转换器必须都支持**：

1. **JSON 编码**（新版 CC）：`JSON.parse(user_id)` 成功 → 取 `.session_id`。
2. **分隔符编码**（旧版，存量 4.2GB 中存在）：形如 `user_<hash>_account_<acct?>_session_<uuid>` → 按 `_session_` 最后一次出现切分取尾段 UUID。
3. **兜底**：两者都失败 / metadata 缺失（heartbeat、countTokens 实测 0% 带 meta）→ 归入**进程当前活跃 session**（进程级缓存最近一次成功解析的 sid）；进程尚无任何 sid（冷启动先来 heartbeat）→ 暂存内存队列，首个带 sid 请求到达后一并落盘；进程整个生命周期无 sid（纯代理无 metadata 流量）→ sid = `noid-<pid>-<startTs>`。
- session_id 语义（实测核实）：每 CC 进程唯一、跨 /clear 稳定、可跨 v1 轮转边界。**/clear 边界不由 sid 判定**，由 §6 的共享谓词判定。

## §9 边界窗口对策总表（v1 WIRE_FORMAT §3 逐条）

| v1 § | 窗口 | v2 对策 |
|---|---|---|
| §3.1 | plan-mode 2-msg 短窗口（故意发） | 写侧落 `snapshot(shrunk)`（不单列 short-window，见 §6 reason 语义），读侧逆锚物化（共享 findReverseAnchor） |
| §3.2 | K 尾重叠+后段新增（故意发） | 同上：前缀测试不过 → snapshot，读侧解决 |
| §3.3 | SUGGESTION MODE 末位替换 | 写侧同 v1 判定（len==P & fp 变）→ `ctl replace-tail`，携带新末位 msg |
| §3.4 | /clear 首个 checkpoint | 共享谓词判 /clear → 新 epoch 文件，journal `boundary:clear` |
| §3.5 | /compact summary 重建 | 同对话继续：`snapshot` + `ctl compact`（不分叉 epoch） |
| §3.6 | 轮转重叠 race | **消除**——session 目录无尺寸轮转；超长 session 的 journal/conv 文件无上限风险由 S6a 列表侧分页兜底，不切文件 |
| §3.7 | 完成序倒置 | **消除于源头**——seq 发起序赋值；conv 行佩戴 seq；物理序不承载语义。移植 delta-reorder.test.js 不变式到物化器测试 |

## §10 teammate / subAgent / IM 归属

- **teammate**（独立进程、独立 sid）：写**自己的** session 目录，meta.leader 记 leader sid + agentName + teamName（来源：argv `--agent-name` 等，进程内 `_teammateName` 直取，不再依赖 prompt 前缀注册表）。
- **leader 视图 re-join（读侧规范，S4 对比与 S5 适配器共用）**：leader 流 = leader session 的 journal ∪ 所有 `meta.leader.sessionId == leader sid` 的 session journal，按 `ts` 升序合并（跨进程 seq 不可比，tie-break `(sessionId, seq)`）；teammate 条目适配时打 `teammate`/`teamName` 双标——与 v1"teammate 写 leader 文件"的读侧形态逐字段等价。
- **proxy 模式 teammate**（v1 §3.7 L104 已知未解：无 `--agent-name` 标识）：其流量在 leader 进程内被拦截，v2 下自然落 leader session 的对应 conv——沿 v1 现状，本重构不解决，此处显式记录。
- **subAgent**（同进程同 sid）：convKey 用 spawn 时 Agent tool_use 块的 `block.id`（响应 content 中可得，v1 丢弃）；异步竞态窗口内未匹配到 id 时 fallback 首 user msg 指纹。同 prompt 并行 subAgent 因 id 唯一不再碰撞。
- **IM worker**：~~S6b 前 spawn 时强制 `CCV_WIRE_V2=0`~~ **【1.7.0 已接入】**IM worker 与主流程同样写 v2；`im-log-watcher` 监听 session 目录（两级拓扑），记录弹窗以 `v2:IM_<id>/<sid>` 寻址。

## §11 v2→v1 适配器逐字段映射（客户端契约）

适配器（S5）从 journal+conversations+responses+blobs 合成 v1 形状 raw entry 流，喂入 `log-stream.js` 两 generator 的现有消费链。合成规则：

| v1 entry 字段 | v2 来源 |
|---|---|
| `timestamp` | journal req.ts（**必须原值**——`${timestamp}|${url}` 是客户端去重键） |
| `url` / `method` / `headers` | journal req 同名字段 |
| `project` | meta.project |
| `body.model` | journal req.model |
| `body.system` / `body.tools` | blobs 按该行 ref 回填（逐请求，绝不沿用） |
| `body.messages` | epoch 起点 → 物化全量（合成 checkpoint）；其余 → append 切片（合成 delta）。snapshot/ctl 行 → 物化器先解决，再按"该请求的物化态"输出 checkpoint（含 §3.3：合成 `_isCheckpoint:true`+`_inPlaceReplaceDetected:true` 成对信号） |
| body 其余顶层字段（max_tokens/temperature/thinking/…） | journal req.params 整体展开（2026-07-16 追加；旧行缺 params → 仅上述字段，与追加前行为一致）。专用字段覆盖 params 同名键：model/system/tools 以专用来源为准 |
| `body.metadata.user_id` | meta.userIdRaw **原样**（客户端等值边界检测依赖——`-c` 采纳目录内真实 user_id 会变化，params.metadata 的其余键合并保留，但 user_id 恒取 meta.userIdRaw） |
| `response` | responses.jsonl 按 seq（statusText 同行回填）；req-without-done → 无 response + `inProgress:true` + `requestId:rid` |
| `duration` / `isStream` | journal done.dur / req.isStream |
| `isHeartbeat` / `isCountTokens` | journal kind 映射 |
| `mainAgent` | kind==main → true；teammate 条目按 v1 双标语义（re-join 时依 meta 复原） |
| `teammate` / `teamName` | meta.leader 存在时打标 |
| `_deltaFormat` / `_totalMessageCount` / `_conversationId` / `_isCheckpoint` | 合成 delta envelope：`_deltaFormat:1`、`_totalMessageCount`=物化计数、`_conversationId:'mainAgent'`、epoch 起点/物化重置点 `_isCheckpoint:true` |
| `_seq` / `_seqEpoch` | journal seq / `v2:<sessionId>`（仅 main 非 teammate，同 v1 语义。注意此 `v2:` 前缀是客户端 seq 作用域的不透明串，与 §12 寻址串 `v2:<project>/<sid>` 是两个不同命名空间，勿混用） |
| `_staleReorder` / `_reconstructBroken` | **绝不输出**（v2 源头无倒置；物化降级为内部态） |
| `proxyProfile` / `proxyUrl` / `proxyRole` | journal req.proxy |
| `ccvRotationContext` 哨兵 | 不再产生（无轮转）；`teammateNames` 等价信息由 re-join 元数据合成同形哨兵，保客户端零改动 |

带宽注：合成 delta envelope（而非逐条全量）使 v2 适配输出 ≈ v1 的 delta 流但**无周期 checkpoint**（epoch 起点才有），冷加载字节数低于 v1。大 epoch 的起点 checkpoint 合成必须流式（不整段驻留内存）。

**窗口读两遍化（S10a，2026-07-15 OOM 止血）**：`readV2WindowedEntries` 曾单遍合成整会话 v1 形状并**全部留存**再切尾窗（每条内联 blob+全量 messages，~10× 磁盘体量；真实 70MB 会话→683MB 字符/~1.5GB 堆，并发加载即 OOM）。现改两遍:**Pass A** 在 `SessionSynthesizer` 的 descriptor 模式下跑**完整** pump/gate/replay（`§11` 的 crash-orphan 跳过、`msgTo` 门都依赖重放态,故纯 journal 扫描不可行——见 §14）,但跳过 blob 回填/messages 组装/`JSON.stringify`,只产 `{ts,url,seq,isMain,isMainDelta}` 轻量记录用于选窗;**Pass B** 只对窗口成员物化并流式交付,窗口起点若为 delta 则用该 seq 的重放态就地提升为 checkpoint(与旧收尾重建逐字节一致)。窗口路径字节金样等价旧单遍;`since` 下推进 Pass B(只物化 `ts≥since`,治 `/events` 增量重连的全量物化 OOM)。旧 `onScan` 钩子退役,最新 ≤3 条 mainAgent raw 由返回值 `mainAgentRing` 交付(判据 `item.isMain`——kind 为准,非重算的 body 标记;teammate 会话 main 条目与"body 长得像 main 的 sub"均排除)。**合流(S10b)**:`server/lib/v2/singleflight.js` 两级共享——一级按 sessionDir 共享 Pass A、二级按 (dir,limit,before) 共享全窗 Pass B;500ms TTL 微缓存(上限 8 条,超出按插入序逐出)只服务只读历史面(`/api/local-log`、IM),绝不读 `/events` live-attach 的缓存(陈旧窗口会放大冷加载→`clients.push` 之间的广播丢失窗口)。注:`cached=false` 只保证「不从 ≤TTL 缓存读」,仍会汇入正在执行的同键 run,陈旧度受限于一次 in-flight run 时长——/events 只用一级轻量 scan flight,该时长很短,客户端下次 since 重连补齐。

**无界流线序(S10c,已知可接受差异)**:`limit=0` 路径(`/api/requests`、workspaces 重载、显式 `?limit=0`)按合成(seq)序流式发射;有界路径(默认 `/events` 冷加载)按 Pass A 首现序、与历史逐字节一致。仅当两条 entry 共享 `timestamp|url`(同毫秒同 url,如 countTokens 突发)时无界流的去重幸存者出现在其较晚 seq 位置而非首现位置——客户端按同键重去重、main delta 靠 `_seq`/`_seqEpoch`(非数组下标)重建,终态与线序无关,故接受(测试见 `test/v2-window-two-pass.test.js` 碰撞用例)。

## §12 寻址与 API 契约

- v2 寻址串：**`v2:<project>/<session_id>`**，用于一切现有 `?file=` 参数位（`/api/local-log`、`/api/download-log`、`/api/entries/page` 等）。`validateLogPath` 增加 v2 分支：剥前缀后 realpath 校验必须落在 `LOG_DIR/<project>/sessions/<session_id>/` 内。
- `listLocalLogs`：v2 目录项 `{file:"v2:<project>/<sid>", kind:"v2", timestamp:meta.startTs, size:目录字节和, turns:journal main-done 计数, preview:首 user msg 截断, instanceId:meta.instanceId, archived:false}`；归属过滤用 meta.instanceId（替代 v1 文件名 pid 前缀）。
- `downloadLog`：`format=rebuilt`（默认）→ 适配器合成 v1 形状 `.jsonl` 流式下载；`format=raw` → session 目录打 zip。
- `workspace-registry.getWorkspaces` 计数：`*.jsonl` glob 之外累加 `sessions/*/journal.jsonl` 的存在与目录尺寸。
- 归档：v1 的日志归档/合并功能已于 2026-07-14 整体移除（jsonl-archive 模块已删）。若未来需要 v2 session 目录打包（S6a raw 下载），压缩与缓存机制需另行设计,不再有可沿用的基座；merge 语义对 v2 不适用（session 天然独立）。

## §13 写路径时序（S3 接线规范）

请求发起（同步段，与 v1 `_seq` 同点）：解析 sid（§8）→ 确保 session 目录/meta（首见时 mkdirSync+原子 meta）→ 判定 convKey/epoch/事件类型（§6，**用 :773 捕获的原始 messages，先于 :839 的 delta 原地改写**）→ 计算 blob hash → 分配 seq → 入队：blob（如新）→ conv 行 → journal req 行。
响应完成（v1 完成写点）：入队 responses 行 → journal done 行。
一切 v2 步骤包裹 try/catch → `reportSwallowed('v2-write', err)`；任何失败不得中断 v1 流程。ENOSPC 预检：v2 启用时低于阈值（默认 1GB 可用）→ 本次 v2 跳过并 reportSwallowed 一次性告警。
生命周期挂点：`resolveResumeChoice`/`initForWorkspace`/`resetWorkspace` → 关闭当前 v2 session 状态（内存计数清零，目录不动）；`checkAndRotateLogFile` 对 v2 无操作（无轮转）。`_temp.jsonl` 暂存约定：**v2 无等价物**（v1 该机制服务于"resume 时日志文件改名接管"，v2 的 session 目录以 sid 为名、天然无需 claim/改名——决策记录）。

## §14 读侧容错（对应 v1 §5）

- **reader 版本门禁（任何未来格式演进的前置条款）**：写侧在 meta.json 与 journal 哨兵首行双处盖章 `wireFormat`（常量单一所有者 `layout.js WIRE_FORMAT_VERSION`）。读侧（`readSession`）必须校验两处（哨兵优先，逐文件自描述），版本未知/更高 → 整会话**拒读**：`readSession` 返回 `unsupported:true` + 空折叠，adapter 拒 yield + reportSwallowed，列表跳过该会话，verify 将其计入 `unsupportedSessions` 并使报告 FAILED（金门不允许带覆盖缺口通过）。版本字段缺失（创建撕裂）按当前版本容忍。理由：`isV2SessionDir` 只是存在性探针，若无本条款，未来 wireFormat:3 目录会被旧读路径当 v2 静默误读渲染垃圾。任何非增量格式变更必须先递增 `WIRE_FORMAT_VERSION`，且新 reader 必须先于（或随同）新 writer 发布。
- journal 尾行截断：JSON.parse 失败即丢弃该行（pendingTail 思路，v1 同款）。
- **可丢弃会话（2026-07-16）**：Claude Code 的配额探针（`max_tokens:1`、单条 `'quota'` 消息、一次性 session_id，启动/派生 agent 团队时触发）会按 §8 铸造只含一条 sub 请求的孤儿会话目录。读侧统一判据 `isDiscardableSession`（session-select.js）：**meta.leader 缺失且 journal 无 kind 'main'/'teammate' req 行** → 该会话被一切读取面舍弃（日志列表 listV2Logs、IM latest 选取、workspace sessionCount/自动 -c、stats、live-feed attach、teammate 归属的 leader 候选——最后一项顺带修复探针目录在无主 teammate tie-break 中偷走真实 leader 流量的 bug）。直接寻址（validateLogPath）不拦截（软删除依赖）；判据只读、自愈（目录一旦获得首个 main req 即在下一轮扫描/轮询现身）。写侧不阻止（无法预知某 sid 后续是否有真实流量）。
- **超大文件流式读取（2026-07-16，issue #129）**：所有会话 JSONL（journal/conv/responses）经 `jsonl-read.js iterateJsonlLines` 分块读取、字节级找 `\n` 后逐行解码——整文件 `readFileSync` 会在 Node 字符串上限（~512MiB）抛 `ERR_STRING_TOO_LONG` 并使启动扫描崩溃循环。单行达到上限 → 跳过该行 + reportSwallowed（每文件一次）。会话级兜底：`iterateSessionItems` 捕获 `readSession` 任意异常 → 该会话降级为不渲染（reportSwallowed），扫描与其余会话存活；stats-worker 同样按会话隔离。
- journal 行引用的 blob/conv 行暂缺（写序窗口内）：该 entry 暂标不完整，watcher 下一 tick 重试；持续缺失（孤儿引用，理论上仅目录被外部篡改）→ 跳过 + reportSwallowed。
- conv 文件存在而 journal 无对应行（崩溃孤儿）：物化器忽略无 journal 佩戴的 conv 行。
- 两相折叠：同 seq 多条 done（不应发生）取首条；req 缺失而 done 存在（不应发生）丢弃 done。

### §14.1 live 读侧的事件排序（2026-07-15）

冷读一直是全量拼接后按 seq 全局排序;live 读侧(SessionSynthesizer.ingestConvLine)自 2026-07-15 起对事件窗口做**按 seq 有序插入**(按序到达 O(1)),以承接历史上被修复前写入器打乱的跨 epoch 文件顺序——否则低 seq 事件会搁浅在单调消费指针之后,触发 missing-conv-event/state-count-mismatch 误报(数据盘上完好)。

## §15 体积预算（301MB 参照文件推算）

| 成分 | v1 | v2 |
|---|---|---|
| tools/system 重复 | ~125MB | blob 去重后 <1MB |
| mainAgent 周期 checkpoint | ~113MB | 0（epoch 自足） |
| subAgent 全量+双写 | ~129MB | 增量事件 ~3–6MB |
| placeholder 双写 | （含上） | journal req 行 ~1KB/条 |
| responses | ~5MB | ~5MB |
| journal+meta 开销 | — | ~2–3MB |
| **合计** | **301MB** | **≈12–18MB（4–6%）** |

S4 双写期以实测值替换本表并回填状态表。

## §16 保留期与清理策略

- **双写期**：v1 与 v2 副本并存（v2 增量 ≈ v1 的 4–6%，可接受）；任何工具不得自动删除任一侧。
- **S9 切换后**：v1 存量文件与双写期 v1 副本的清理**由用户显式决策**，工具只提供辅助（`ccv convert` 完成校验后输出"可安全归档/删除"清单，实际删除走既有 UI 的软删回收站路径）；本重构不内置任何自动回收。
- v1 `.jsonl` 读取能力长期保留，未转换的旧文件永远可浏览。历史 `.jsonl.zip` 归档已随归档功能移除（2026-07-14）不再支持读取——需手动解压回 `.jsonl` 方可浏览/迁移。
