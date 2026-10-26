# 日志存储架构治理：Wire Format v2（会话化 + 去重）跨 session 分步实施计划

> 本计划经 4 个探索 agent（写入端/读取端/客户端/风险测试）+ 3 个评审 agent（完整性/风险回滚/事实核查）交叉验证，全部 file:line 断言已核实。

## 步骤状态表（每步 commit 时更新本表——仓库是进度真相源）

状态图例：⬜ 未开始 ｜ 🔄 进行中 ｜ ✅ 完成（附日期 + commit）

| 步骤 | 内容 | 状态 | 日期 | commit | 下一步动作备注 |
|---|---|---|---|---|---|
| S-1 | 跨 session 追踪落地（本文档 + 记忆指针） | ✅ | 2026-07-13 | c88d704 | — |
| S0 | 协议定稿 docs/refactor/WIRE_FORMAT_V2.md | ✅ | 2026-07-13 | 0b5a87d | 用户评审通过 |
| S1 | 共享边界+逆锚模块（clearCheckpoint 迁移 + findReverseAnchor 抽取） | ✅ | 2026-07-13 | 9f44715 | 实际只改 2 个消费方（shell 使 contentFilter/entry-slim/sessionManager 免改，属计划预期内收窄）。评审 P2 backlog：docs/WIRE_FORMAT.md:46/:170、sessionManager.js:552/:555、test/entry-slim.test.js:906、test/session-boundary-parity.test.js:12 的"函数老家"注释应改指 session-boundary.js；WIRE_FORMAT.md §6 维护责任补 canonical home——并入 S2 或 S9 文档轮 |
| S2 | v2 核心库 server/lib/v2/*（纯新增不接线） | ✅ | 2026-07-13 | 074a2c2 | errorReport 移至 server/lib（src 不发布）；2 个评审 agent 报告在 S3 期间跟进整合 |
| S3 | 双写接入（writeEntry seam + CCV_WIRE_V2，默认关） | ✅ | 2026-07-13 | 42fbc40 | 2 个 S2 评审 + QA 评审全部整合（seq 播种/response headers/late-handle 等）。回滚=CCV_WIRE_V2=0。soak 人工闸门跨入 S4：`export CCV_WIRE_V2=1` 后正常使用 ccv。s3-review 报告未回收，若有发现随 S4 整合 |
| S4 | 一致性校验工具（ccv verify）+ ≥5 活跃日双写验证（人工闸门） | ✅（闸门被 1.7.0 决策取代） | 2026-07-14 | (1.7.0) | 代码已提交（与 S5/S8 合并提交,文件级 hunk 交叠无法拆分）。digest 归一化已拍板落地（见下表 2026-07-13 行）→ **soak 计日现在可以开始**;需先重启常驻 ccv 使 live 双写吃到新代码。脱敏真实 fixture 在 soak 期采集提交 |
| S5 | v2→v1 适配读层（CCV_WIRE_V2_READ，默认关） | ✅（1.7.0 起无条件生效，开关移除） | 2026-07-14 | (1.7.0) | 代码+自动化测试完成并已提交（合并提交）（adapter.js 机械 replay + 信封合成、log-stream isV2SessionDir 分派、v2: 寻址、mode 解锁 dual-read、日志弹窗「v2 读取」开关、§14 读侧容忍 4 例、round-trip golden、HTTP 级 server-v2-read 套件）。**S6a 列表选择部分按用户要求提前并入本步**：弹窗第三开关「v2 会话列表」（`/api/local-logs?v2=1`）+ listV2Sessions/listV2Logs（meta.instanceId 归属过滤、teammate 会话折叠进 leader 不单列）+ LogTable v2 行（v2 tag、不可勾选、開啟走既有 ?logfile= 流）+ download rebuilt（raw zip 仍留 S6a）。合成数据端到端浏览器冒烟已通过（列表→開啟→完整渲染含 Context 工具/系统回填）。**待办**：① 真实双写数据上的 soak 期日常使用验证（人工闸门，与 S4 soak 同期进行）；② 与 S4 一并提交（用户已选暂不提交）。计划偏差记录：resolveLogSource 泛化实际落在 log-stream 的 isV2SessionDir 分派（jsonl-archive 零改动，validateLogPath 承担 v2 寻址校验）。注意：S5 与 soak 并行开工（用户决策 2026-07-13），S4 soak 闸门仍未开始计日 |
| S6a | 列表/管理/寻址切换（listLocalLogs、workspace-registry、download 契约） | ✅（1.7.0：列表恒 v2；软删除落地；raw zip 延后） | 2026-07-14 | (1.7.0) | raw zip 下载仍 400（backlog） |
| S6b | live watcher + IM 接入（最高风险，单列） | ✅（1.7.0：live-feed.js 两级 watcher + SessionSynthesizer 单一合成路径；IM 同步接入；v1 tail 移除前通过 v1/v2 live A/B parity 闸） | 2026-07-14 | (1.7.0) | — |
| S6c | 统计与残余（stats-worker 重键、死代码退役） | ✅（1.7.0：stats v9 直解 journal+conv 事件；死代码清单全退役） | 2026-07-14 | (1.7.0) | v1 文件不再计入统计（迁移后恢复） |
| S7 | 客户端原生 v2（7a 数据通道 / 7b 复杂度收敛） | ⬜（1.7.0 决策：不做——adapter 长期供给 v1 形状；原 7a 拟复用的 loadColdSession/loadMoreHistory 已随「仅当前会话唯一模式」删除，S7a 设想作废） | | | |
| S8 | v1→v2 转换工具（ccv convert，存量 4.2GB，严格只增） | 🔄 | 2026-07-14 | d42b94a | 主项目（cc-viewer）已重转完成并提交；其余项目（cx-viewer/sam3/sky/test）待用户择机用按钮或 CLI 转换。**按用户要求提前实现（顺序偏差：先于 S6/S7）**。已落地：`server/lib/v2/convert.js`（升序逐文件、暂存区 sessions-migrating、全量 golden 校验后 promote、文件级断点续传、session 级跳过双写权威数据、空间断言）+ convert-worker/convert-manager（server 内常驻，重启自动续传——计划外新增面，用户决策）+ 弹窗 v1 列表「日志一键迁移」按钮（POST/GET /api/wire-v2-convert，2s 轮询进度）+ `ccv convert <project…>|--all`。原「默认 dry-run」被「暂存+校验+promote」取代（同等安全性，一键化）。测试：test/v2-convert.test.js 10 项 + server-v2-read HTTP 契约（用户决策 2026-07-14：以单元测试保障为准，免真实数据交互演练）。**2026-07-14 真实数据首跑修复**（用户按钮实测 golden FAILED 于最老文件,根因三连）：① ConversationStore 判定从「只看尾指纹」升级为**逐消息指纹数组+全前缀校验**（老日志同 sid 交错流共享前缀/尾部而中段不同,§3.7 L104 形态,尾检误判 unchanged/replace-tail → replay 拼接怪）,前缀失配一律回退 snapshot;另加 **exactFps 模式（转换器专用）**——fingerprintMsg 80 字符截断分辨不了长同前缀 wire,离线判定追加全文 FNV-1a,golden 门按构造字节忠实,live main 请求路径默认也使用归一化全文判定（sub/misc 保持廉价默认）；② 老条目无 requestId + 冷启动 hold 的 completion 先于 flush 到达 → convert 合成 rid + pendingDone 缓冲重放;③ verify 的 ts|url 键在同毫秒 countTokens 突发下不唯一 → indexSession/verify 改多候选匹配（digest 优先配对,轮转孪生计 v1DuplicateKey 不判失败,P3「重复 completed 双计」就此解决）。**2026-07-14 JSONL/去重审计 → 全量重转完成**：多 agent 审计量化首轮迁移产物（45 会话 2.0GiB）~62% 字节为 snapshot 逐字节重录，联合根因 = identity 键控 bug（见「关键事实」已修复项）× exactFps 对 cache_control 迁移敏感（见 S4 表已拍板项）。两修复落地后：首轮产物软删至 `sessions-removed-20260714/`（state 文件同移，可整体移回回滚）→ `ccv convert` 全量重跑,golden 全过 → **转换产物 2.0GiB→387MiB（−80%,≈v1 源的 9%,达成总验证 #4「体积比 ≤10%」）**；sub 会话事件从 6,574 snapshot/0 append 变为 923/5,662,tool_use.id 键控命中 0→71。同轮落地：§14 **reader 版本门禁**（`layout.js WIRE_FORMAT_VERSION` 单一所有者,readSession 拒读未知版本,adapter/列表拒渲染,verify 计 unsupportedSessions 判 FAILED——任何未来格式演进的前置）；cli `--log-dir` 与默认值相同时误拒的 bug（setLogDir 改返回布尔）。审计其余结论（标记文件/SSE 化驳回、方案 C snapshot 后向引用留作 live 残余类演进、方案 E journal headers href、S6b 三条约束）见审计报告（会话 scratchpad,未落仓库） |
| S9 | v1 写入下线 + 收尾 + 一次性发版 | ✅（1.7.0：v1 写全链下线、开关移除、启动迁移引导 + -c 三路检测、软删、版本 1.7.0；与原计划的偏差：S4 soak 闸门未走满 5 活跃日即切换——用户知情决策，缓解=v1 文件永不删除 + 转换 golden 门 + v1/v2 live A/B parity 测试；publish 仍待用户验收） | 2026-07-14 | (1.7.0) | publish 前征询用户 |
| S10a | 窗口读两遍化（Pass A descriptor 选窗 / Pass B 只物化窗口成员，OOM 止血） | ✅ | 2026-07-15 | (未提交) | `readV2WindowedEntries` 单遍会 stringify+留存整会话（真实 70MB→683MB 字符/~1.5GB 堆，并发即 OOM）。两遍化：Pass A 跑完整 pump/gate/replay 但跳过 blob/messages/stringify 产轻量 descriptor 选窗（纯 journal 扫描被否——crash-orphan/msgTo 门依赖重放态）；Pass B 只物化窗口成员并流式交付。`since` 下推进 Pass B（治 /events 增量重连主 OOM 路径）；onScan 退役→返回值 `mainAgentRing`（判据 item.isMain，非 kind）；窗口路径逐字节金样等价、流式路径客户端等价。tail-500 实测堆 1.48GB→218MB（**手工实测,非 CI 守卫**——真实 70MB 会话只在开发机;CI 用合成夹具锁输出正确性,不锁内存数）。测试 test/v2-window-two-pass.test.js（含 dedup 碰撞金样等价 + 全流式增量交付） |
| S10b | 两级 in-flight 合流 + 受限 TTL 微缓存 | ✅ | 2026-07-15 | (未提交) | `server/lib/v2/singleflight.js`：一级按 sessionDir 共享 Pass A、二级按 (dir,limit,before) 共享全窗 Pass B；500ms TTL 微缓存**只服务只读历史面**（/api/local-log、IM 弹窗），**绝不服务 /events live-attach**（陈旧窗口会放大冷加载→attach 广播丢失窗口，F5b）。readTailEntries 默认 cached=true、streamRawEntriesAsync 默认 cached=false。测试 test/v2-singleflight.test.js（Pass A 计数=1 断言、live-attach 拿不到缓存断言） |
| S10c | 收口 limit=0 无界面 | ✅ | 2026-07-15 | (未提交) | 三个 limit=0 路径（/api/local-log 全量、workspaces 重载广播、/api/requests）已随 S10a 流式 Pass B 自动治住——Pass A 只留轻量 descriptor、Pass B 逐条流式，683MB 全量流实测常驻 ~2MB（**手工实测,非 CI 守卫**;CI 用合成夹具锁全流式增量输出正确性）。无需人为截断（原计划的 DEFAULT_EVENTS_LIMIT 前提「仍全量物化」已不成立，/api/requests 保持完整流式输出）。**已知可接受差异**:无界流按合成序发射,重复 ts\|url 时幸存者位置晚于历史首现序——客户端序不敏感,详见 WIRE_FORMAT_V2.md §11。 |

| B | brotli 传输压缩（br\|identity 协商 + 逐事件 flush，wire-compress.js 单缝） | ✅ | 2026-07-16 | c8c6c25 | 实测冷载 20.8×/live 80×；含评审 6 项修复（encoder 感知背压 awaitWireDrain、q=0 拒绝、/api/requests try/catch、no-flush 整流、双分支 Vary、踢除时 destroy encoder）。逃生舱 CCV_WIRE_COMPRESSION=off。**已知边界：浏览器仅在 HTTPS/localhost 发 br——远程明文 http 回退 identity（由 V3 补位）** |
| V3.S1 | `/api/v2-entry` 单条详情（target+prevMain，逐成员 checkpoint 提升） | ✅ | 2026-07-16 | c94c28e | promoteKeys 物化模式；UUID/basename 双寻址（先 resolve 再 validate）；test/v2-entry-endpoint.test.js |
| V3.S2 | `v2_requests` 元数据行通道（journal 折叠 + 有界 Pass B typeTag/cacheLoss） | ✅ | 2026-07-16 | add9835 | classifyRequest 服务端复用（requestType 链补 .js 扩展名单源）；三处有意偏移测试钉死；旗标 deps.wireV3 启动读一次 + server_config 广播 |
| V3.S3 | 旗标前端：列表自行渲染 + 按需详情 | ✅ | 2026-07-16 | a43ffb6 | _listSource() 单缝（桌面/移动共用）；componentDidUpdate 驱动 fetch + abort；entryCache protocolVersion 单门（不 bump DB_VERSION——暗着陆保命） |
| V3.S4 | 原生 conv/responses 行转发（冷窗 + live 三钩子） | ✅ | 2026-07-16 | 43fb6f1 | 冷载自"最近 snapshot ≤ 窗口起点"；**架构改道（用户批准）：废弃摘录帧方案** |
| V3.S5 | 客户端组装器；旗标线缆停发全量 entry | ✅ | 2026-07-16 | 08bac13 | v3Assembler 重建 v1 形状 entry 喂现有管线（parity oracle 钉死）；深读消费者走 deepRequests；live 停发 data: 帧（kv/context 侧事件保留）。实测冷载明文 176.8→42.5MB（÷4.2） |
| V3.S6 | 翻转默认 + 文档收尾 | ✅ | 2026-07-16 | (本次提交) | CCV_WIRE_V3 默认开、=0/off 逃生舱；WIRE_FORMAT_V3.md 新建；entry-slim **保留**（方案 B 下 v1 遗留/逃生舱仍需，v3 路径天然闲置——取代原"退役"项）；legacy live UI 路径留一个发布周期后再删 |

**恢复协议**：新 session 开始 → 读记忆 `wire-format-v2-progress.md` 指针 → 读本表找到第一个非 ✅ 步骤 → **先跑上一完成步的 named tests 确认仍绿** → 再开工。步骤内中断：状态记 🔄 + 在"下一步动作备注"写明断点。

**全系列评审 P3 backlog（2026-07-13 六人团评审，P1+P2 已全部修复）**：
- 代码：ConvResolver 三个 map 无界增长（加 cap+eviction，_lateHandles 同款）；JSON 分支 session_id 缺 UUID 校验（路径合并风险，identity.js:28）；disk-guard 永久跳闸可选重探测；请求路径每次同步重算 tools/system 哈希（identity 缓存 last-seen ref）；completion 多一次 response stringify；verify 多段合并匹配模式（v2Unmatched 降噪）；verify onScan 对重复 completed 行双计。
- 注释/文档：源码"函数老家"注释 5 处（AppBase.jsx:1904、entry-slim.js:299/304/378/488）并入既有 backlog；sid/sessionId 命名统一；README 补 `ccv verify` 与开关说明（S9）。
- 有意取舍存档：移动端无开关（desktop-only by design）；verify CLI 英文输出（dev tooling）；wire-v2-mode 路由 LAN 可达（与 delete-logs 等既有姿态一致）；新测试沿用中文数据安全横幅（既有惯例）。

**2026-07-14 五人团评审 backlog（P1/P2 采纳项 1-6 已当轮修复：listV2Sessions 哨兵门禁+断言、history.md S8 zip 措辞、normalizeMsgForEquality 注释英文化、HTTP 级门禁用例、setLogDir 回归钉、归一化/剥离边界用例）**：
- P2 convert 跨进程锁：convert-manager 只挡进程内单飞，CLI convertProject 与 server 自动续传共存时 staging 竞写 + promote 的 existsSync→renameSync TOCTOU（golden 门兜底为安全失败但非气密）。方案候选：`sessions-migrating/.lock`（含 pid）双端检查 + promote 遇目标存在一律 fail-closed。
- P2 FNV-1a 双实现统一：conversation-store `fnv1a`（Math.imul，正确）vs identity `promptFingerprint`（双精度乘后截断，低位丢失、碰撞率偏高）。**统一会改变现有 fp 值→convKey 派生变化**，需连同升级语义一起评估，不可顺手改；identity 侧有 fp+序号兜底，非活性 bug。
- P2 replay/adapter 机械重放状态机双份（replayConversation vs iterateSessionEntries 内联三分支）：字节级必须一致却无 KEEP-IN-SYNC 标记。低风险版本=互加标记注释；完整版本=提炼纯函数 `applyEvent(state, ev)` 两处共用。
- P2 `.jsonl.zip` 孤儿归档无应用内提示（用户已拍板全链路移除,changelog 有手工恢复指引;本机实测 0 个 zip）：可选做「不支持——解压恢复」列表行或一次性提示。
- P3 resolveSub 两侧前缀窗口耦合注释（registerSpawns 取 60 字符 raw prompt vs resolveSub 取 200 字符 stripped prompt,两侧都须是 reminder-free 文本,改任一侧长度勿复活 0-hit 回归）；registry 侧「input.prompt 永不含 reminder」假设无钉。
- P3 verify digest 对同 id tool_result 体编辑盲区的边界钉死测试（写侧已检测,读侧 digest 结构性盲,已文档化;可加"故意不报"钉防边界悄然扩大）。
- P3 `/api/wire-v2-convert` 无 isLocal 门（LAN 可达触发重转换,DoS-only,与既有姿态一致——存档）。
- P3 升级瞬间活跃 sub 会话因 fp 派生变化分键（内存态,重启 snapshot(first) 兜底,verify 可见;已被本轮重转缓解——存档）。

**2026-07-14 1.7.0 五人团评审 backlog（P0 无;已当轮采纳:migrate_prompt 一次性守卫〔SSE 重连重弹+continued 绕过 dismissed,rev-correct P1〕、EPERM 判活、Linux birthtime≤0 视为新目录、SessionSynthesizer 完成后释放 responses/dones/events 前缀、live-feed per-session reconstructor、teammate 孤儿归属 sid 平局决胜、死代码补删 teammate-detect/collectFilteredRawEntriesAsync/migrateConversationContext〔含 6 例僵尸测试〕、files-fs 死三元、若干陈旧注释）**：
- P2 live-feed seed 抑制窗口：seed 期 parked 的历史条目在 suppress 清除后可能作为"新条目"晚到广播（尤其 _rebuildCursor 全量重放后）——改为 seed 后 `hasPending()` 清空才解除 suppress,或给 seed 期 seq 打标丢弃。
- P2 done 3s deadline 后 responses 迟到被永久丢弃(live 视图 response 空至冷加载)→ 迟到 responses 对已完成 seq 触发重发完成条目。
- P2 findTeammateSessionDirs:leader meta 不可读时其孤儿 teammate 会被错误重指到别的 leader（平局双归属已修）。
- ~~P2 (rev-quality) interceptor-core 的 rotateLogFile/parseRotationContextHead 退役~~ ✅ 2026-07-14 收尾三修 Part C 完成(连测试一并删;claimUntaggedLog/cleanupTempFiles 随实例移除删除,logFilePrefix/logFileMatcher/findRecentLog 降为 project-only 保留——im.js 依赖);streamReconstructedEntries(Async) 仍零生产消费,退役评估(其注释自述归 S6c)。
- P3 fetch abort/错误路径不写 done 行 → journal 留永久 in-flight;可补 status:'aborted' done。
- P3 stats-worker 项目清空后旧 stats 文件残留(早退不写)→ 写空 v9 对象;journal req 缺 epoch 时 sessionCount 低估。
- P3 live-feed 根 watcher 事件推进 _seenDirs 导致 resumed 会话再挂延迟一拍。
- P3 readV2WindowedEntries 跨 leader/teammate 合并后 ts|url 撞键窗口变宽 → key 可并入 _seqEpoch;另:每个 main delta 的 stateRef 全程驻留(仅窗首用到)→ 可二遍法省内存。
- P3 live-feed seed 期间落盘的新 append 在同一 do-while 里被一并抑制(既不在冷快照也不广播)→ 记录 seed 截止 offset,只抑制其之前的内容。
- P3 (rev-compat) entryCache 旧浏览器残留孤儿 sessions store(DB_VERSION 未升)→ 升 3 + deleteObjectStore 回收;concepts/*/GlobalSettings.md 各语言仍记载 resumeAutoChoice 行。
- P3 `ui.allConversationsLoaded` 键疑似失去消费者;cli.help 未列 convert/verify 子命令。
- 待用户验证存档：冒烟中两次「未点击即开始转换」未定案——评审在打包产物层面穷举排除了全部前端自动路径,最可疑为 maybeResumeConvert 开机续传(状态文件 running 残留)与 a11y uid 点击错位的叠加;真实环境复现时优先查 `<project>/wire-v2-convert-state.json` 的 status 与服务端 “resuming unfinished migration” 日志行。

**2026-07-14 收尾三修（用户三项要求,4 探索+3 评审 agent 计划闭环）**：
1. 「仍在双写 v1」诊断=旧进程(06:36 启动的 `ccv -c` pid 49263 + 7/13 的 IM bot pid 12384 内存持旧代码;lsof+mtime 时序证明),代码无活 v1 写路径,重启即止;顺手删净死 v1 写入器(rotateLogFile/parseRotationContextHead/claimUntaggedLog/cleanupTempFiles)。
2. 日志弹窗 v2/v1 双视图:v2 恒默认;`_v1FileCount`(盘上文件数,非未迁移数——转换器不删源)gating 的小链接入口进 v1 视图;迁移按钮/进度/未迁移提示只在 v1 视图;v1 视图支持查看/下载/迁移/软删;`?view=v1` + 简化版 listLocalLogs(去实例化)恢复;启动迁移弹窗保留,「立即迁移」直接打开 v1 视图看进度。
3. 实例概念整体移除:--pid/CCV_INSTANCE_ID/meta.instanceId 写入/列表归属过滤+「显示全部实例」开关/instance-registry/标题 (id) 后缀/per-instance session-pin(合并为单一 .session-pin.json,旧文件留盘孤儿)/相关 i18n ×18;行为变更=同项目并行 ccv 互见会话。旧 meta.instanceId 会话正常列出(读端容忍)。
三修后三人团评审:0 P0/P1;当轮采纳=interceptor 双 ingest 点外层 catch 升级 reportSwallowed、_v1FileCount 口径与 v1 视图行一致化(countListedV1Files,时间戳正则+非空,徽标数≠行数漂移堵死)、converted-but-present 分歧钉死测试(+_currentProject 断言)。遗留 P3(不阻塞):v1 视图 spinner 与 v1 数据刷新时序的瞬时空窗(localLogsLoading 只跟 v2 fetch);handleMigrateNow 里 setState 未落地即读 logView 的无害冗余 fetch;convert 运行中切回 v2 视图无进度指示(接受,启动弹窗直开 v1 视图);session-pin.test 裸跑(无 --test-force-exit)因 import interceptor 常驻句柄不退出(既有模式);server-logs.test 中途 initForWorkspace 对后续新增用例的潜在顺序耦合(可选 afterEach resetWorkspace 加固)。

**2026-07-14 深夜:日志列表两组数据优化(概览 prompts 静态化 + 大小口径)——三人团评审闭环**:
- 已采纳:writer 级 replace-tail 捕获测试(P1)、stats ctl 行 fixture 钉(P2)、synthetic prompt(Recap/Title/Compact/Topic/Summary)过滤并入共享提取链(P2,真实数据 5/31 会话实测泄漏;与 src/utils/contentFilter.js SYNTHETIC_PROMPTS KEEP-IN-SYNC)+ 回填 --force 重跑洗净。
- 遗留 backlog:P2 workspace-registry 的 dirSizeSync 为主线程同步递归走盘(56 会话规模毫秒级可接受,corpus 增长后改 async 或下放 worker);P3 PROMPTS_MAX_PER_SESSION 上限无测试缝(需 opts 暴露才可测);P3 缓存路径(整会话 prompts)与兜底路径(仅 e0 首行)预览条数不一致;P3 stats 单元 size 在裸 meta 更新后滞后一拍(无 UI 消费);P3 e0 首行 >256KB 时兜底预览为空(既有行为)。

**2026-07-15 凌晨:live-feed 误报双根因修复(3 法证/机制/读侧探索 + 2 评审 agent 闭环)**:
- 根因①(写侧):重启接续的 fresh ConversationStore epoch 恒 0(journal seq 有盘播种、epoch 没有)→ 新 seq 追加进旧 epoch 文件,跨文件 seq 序破坏。修复=_state 创建时从磁盘播种 max e<N> + snapshot(first) 条件去掉 epoch===0。
- 根因②(读侧):live 无冷读的全局 seq 排序,单调指针搁浅乱序事件 → 3s 死线降级误报(missing-conv-event/state-count-mismatch;数据完好,冷读恒正确)。修复=ingestConvLine 按 seq 有序插入(按序 O(1))。
- 法证澄清:初始"agent 混流"理论被推翻——真 Agent 子代理全部正确路由 sub-fp-*;billing cc_version nonce 证明 3 代进程先后接力非并发;单写者零重复 seq。exp5-identity 的 spawn-registry 改判方案存档不实施。
- 修后二人评审 0 P0/P1;当轮采纳:epoch 播种 max 语义 gap 钉死测试(e0+e5→5)、listV2Logs/listLocalLogs 中文 stderr 英文化;测试钉合力校准:v2-core 重启用例同时钉 Fix A 两半,adapter out-of-order 用例钉 Fix B,live-feed 代际用例只钉 Fix A 的盘上不变量(验收级);冷读对 epoch 文件错位天然免疫(全局 seq 排序)再次核实。遗留 P3:snapshot(first) 条件里 prev===0 与 count===0 恒等(死条件,化简可选);外围 1.7.0 文件(im-log-watcher/stats-worker)仍有中文注释(提交前清理项)。
- backlog 新增:真·并发同 sid 双写者(两终端 `claude -c` 同会话)= seq 碰撞硬损坏(journal.js:24-25 既有文档,本轮未发生未加重)→ billing-nonce(cc_version 后缀)按进程分流是候选方案;已膨胀历史目录(约 10MB 重复 snapshot/会话)无 live 内安全清理手段,留档;重启首 wire 恰为 post-clear checkpoint 时 epoch 标签滞后一格(记入 §6.1)。

### S4 双写验证日志（验证期逐日追加）

工具已就绪（`ccv verify <v1文件>` / `npm run verify:wire-v2 -- <v1文件>`），soak 操作流程：
1. 开启双写（二选一）：日志弹窗里的「v2 双写日志」开关（写 `LOG_DIR/wire-v2.json`，**下次启动生效**）；或 shell `export CCV_WIRE_V2=1`（env 覆盖配置文件，双向逃生门：`=0` 强制关）。
2. 正常使用；每个活跃日结束跑 `node cli.js verify ~/.claude/cc-viewer/<project>/<当日 v1 文件>.jsonl`。
3. 结果（OK/FAILED + matched/diffs 数）追加到下表；连续 ≥5 活跃日全 OK 才进 S5。
4. 期间采集一份脱敏小型真实 fixture 提交 test/（S5/S8 golden 复现用）。

| 日期 | v1 文件 | matched | diffs | 结果 |
|---|---|---|---|---|
| 2026-07-13 | cc-viewer_20260713_011511.jsonl（活跃中跑的,非日终） | 180 | 50+（capped） | FAILED（假阳性,见下） |

**2026-07-13 FAILED 根因分析（非 v2 bug,是 verify ① 门的假阳性类）**：全部 50 条 diff 同一根因——均为 `messages-digest`、同一 session（0398a471）main 会话、seq 12..61 完全连续、v1Len==v2Len 全等、integrity 0 违例、tools/system CAS 0 diff。seq 12 处客户端把 `cache_control`（ttl 1h）断点迁移到旧消息 msg[3] 上，wire 真实发送形态从纯字符串 content 变为带 cache_control 的 block 数组；v2 写侧（内容感知指纹）检测到旧消息变形→落 snapshot 如实记录，而 v1 delta 格式无法表达旧消息原地变形（重建永远复用旧记录）→ 两侧 digest 自此级联失配。v2 比 v1 更接近 wire 真相。**待决策**：digest 需归一化（剥离 cache_control + 统一 string ↔ `[{type:'text'}]` 形态）才能让 soak 门可用，否则每个真实活跃日都会因此 FAILED。**→ 已拍板并落地（2026-07-14，用户决策）**：新增 `session-boundary.js normalizeMsgForEquality`（string→text-block 形态统一 + 剥离顶层 block 的 cache_control），verify 的 `messagesDigest` 与转换器 exactFps 两处消费——`messageFingerprint` 的 `s|`/`t|` 形态标记不再因迁移分叉（soak 假阳性根因），exactFps 的全文 FNV 不再对 cache_control 迁移逐请求敏感（转换产物 snapshot 风暴次因）。**存储路径不受影响：落盘事件永远保留 wire 原文**，归一化仅用于等价性判定。soak 门自此可用，计日可开始。

## Context

cc-viewer 把拦截到的 Claude API 报文写入单一 JSONL（`\n---\n` 分帧，250MB 轮转），实测 4.2GB/16 文件。301MB 典型文件成分：mainAgent 周期 checkpoint 37% + subAgent 无 delta 且双写 43% + mainAgent delta 20%；每条 entry 的 `body.tools`(~125KB)+`body.system`(~12KB) 全量重复（145KB 的 delta 中 126KB 是不变的工具定义）。净信息量 15–25MB，**目标缩减 >90%**。

用户决策：**① 全部完成后一次发版**（中间只 commit main，不 publish 不动版本号）；**② 双写过渡**（v1 写入直至最后一步不动，v2 旁路落盘、真实数据对比验证后才切读端）；**③ 提供 v1→v2 转换工具**。实现跨多 session，进度打标追踪。

## 关键事实（已核实，含评审修正）

**身份与键控**
- session_id 藏在 `body.metadata.user_id`，**有两种编码并存**：新版 CC 是 JSON 字符串 `{device_id,account_uuid,session_id}`；旧版（存量 4.2GB 中存在）是下划线分隔 `user_<hash>_account__session_<uuid>`，`JSON.parse` 会失败。**解析器与转换器必须兼容两种**（先 JSON.parse，失败则按 `_session_` 段切）。
- session_id 每 CC 进程唯一、**跨 /clear 稳定**（实测同 sid 下 90+ 个 /clear checkpoint）→ 两级结构：session（进程）→ conversation epoch（/clear 分段）。`/compact` 不换对话（continuation 判别）。同一 session 实测跨越 v1 轮转边界 → 按 session 分目录天然消灭 §3.6 race。heartbeat/countTokens **无 metadata**（实测 0/332 带 meta）→ 兜底路由到进程当前 sid。
- 边界谓词已存在且客户端安全：`src/utils/clearCheckpoint.js`（自称"无依赖"，已导出 isPostClearCheckpoint/isCompactContinuation/isSessionBoundary），被 sessionManager/sessionMerge/entry-slim/contentFilter 消费；big-drop 公式 4 处副本中 **entry-slim 的 3 处是故意分化的（restore-guard），不得盲目统一**。§3.1/§3.2 窗口目前只靠 `sessionMerge.findReverseAnchor` 解决。
- subAgent spawn 注册表按 prompt 前 60 字符键控（`interceptor-core.js:27-41`），并行同 prompt 会碰撞；Agent tool_use 块的 `block.id` 在响应 content 里存在但被丢弃 → v2 改用 tool_use.id 键控（已核实可行）。**【2026-07-13 实测修正】**真实数据中 tool_use.id 键控 0 命中（所有 session 的 sub 全部是 `sub-fp-*`）：harness 会在 sub 首条 user 消息前注入 `<system-reminder>`（claudeMd 上下文）text block，`identity.js` 的 `firstUserPromptText` 不跳过它 → 按 prompt 前缀查 `registerSpawns` 注册表永远 miss。正确性由 fp+序号后缀兜底保住（并行同 prompt 仍能分开），但设计主路径实际是死代码；同根因还导致 `listV2Sessions` 的列表 preview 显示 `<system-reminder>` 噪音而非用户首条真实提示词。修法候选：`firstUserPromptText` 跳过 `<system-reminder>` 开头的 text block（键控与 preview 一并治好）。**→ 已修复（2026-07-14）**：`identity.js` 新增 `stripLeadingReminders`（仅剥离头部 reminder 段，含未闭合容错），v2-core 三例回归（剥离本身 / reminder 前缀下 tool_use.id 键控命中 / 并行不同 prompt 同 reminder 前缀分键）。审计确证该 bug 是首轮转换产物 sub 快照风暴的主根因之一：并行 sub 的 fp 全取自 200 字符 reminder 样板 → 兄弟请求交错进同一 convKey → 永远 tail-mismatch 全量 snapshot（实测转换产物 sub 会话 6,574 snapshot / 0 append）。
- teammate 独立进程、有自己 session_id，但写 **leader 的日志**（`interceptor.js:349-357`），条目可双标；proxy 模式 teammate 可能无 `teammate` 字段（§3.7 L104 已知未解，本重构不解决，归 leader 流并文档化）。

**写入端**
- 落盘点 = **1 placeholder（:856）+ 5 完成/错误（:1095/:1106/:1191/:1220/:1225）共 6 处**，全部写完全物化 entry → 收敛为 `writeEntry()` seam。**rotation sentinel（:530-537，创建文件时原子落盘）不进 seam**，v2 journal 首帧同样要创建即原子写。
- delta 在 :839 原地改写 `body.messages` 为 slice → v2 tap 用 :773 捕获的 `messages` 局部变量（改写前原始数组）；tools/system 从不被改写（proxy 改写只碰序列化副本），可安全哈希。
- `_seq` 在请求发起同步段赋值（:781-782，`!_isTeammate`）→ journal seq 必须同点赋值，否则复活 §3.7。
- `AsyncWriteQueue` 已按 path 分组 drain、空 path 静默 no-op（保留）；**无 fsync、错误裸吞**（:56/:78，违反 reportSwallowed 约定，v2 修）；append 非阻塞（请求路径零延迟），但同队列有 HOL 排队 → journal 可考虑独立队列实例（P2）。
- 生命周期挂点：`resolveResumeChoice`(:230)/`initForWorkspace`(:410)/`resetWorkspace`(:464)/`checkAndRotateLogFile`(:519)；`_temp.jsonl` 暂存→改名约定（:247/:395，IM watcher 显式排除该后缀）需在 S3 声明 v2 等价物。
- live-stream 是附加投递非磁盘替代 → v2 在完成写点 ingest；stream-progress timestamp 必须 == 最终条目 timestamp。
- 现有 flag 先例：`CCV_DISABLE_DELTA`(:271)、`CCV_DISABLE_TAIL_FP_CHECKPOINT`(:274)。

**读取端（服务器）**
- 主 seam = `log-stream.js` 两 generator（:25/:67），全部流式 endpoint 建立其上，喂同样的"逐条 raw JSON 字符串"即可 ~80% 零改动。
- 旁路读取：`log-watcher._readDelta`(:134, live tail，最高风险)、`stats-worker.parseJsonlFile`(:143)、`logs.readHeadRotationContext`(:213)，以及**死代码退役清单**：`readLogFile`/`readLocalLog`/`migrateConversationContext`（三者零调用方）。
- 计划此前遗漏的消费方（评审补）：**`workspace-registry.getWorkspaces`(:97-107) 按 `*.jsonl` glob 计数**；**IM worker 体系**（`LOG_DIR/IM_<id>/*.jsonl` + `im-log-watcher.js` + `im.js:259 findRecentLog`）；`downloadLog` 的 `format=raw|rebuilt` 契约。
- `delta-reconstructor.js`（CLIENT-SAFE，AppBase.jsx:24 与 ImConversationModal.jsx:8 浏览器端 import）与 `teammate-detect.js` 零改动。无 `_deltaFormat` 的条目被当 checkpoint 透传（:34）——两种 envelope 策略都可行。
- stats-worker 缓存按 size+mtime → v2 按 journal offset 重键。读端 `${timestamp}|${url}` 去重与 blob 去重正交，都保留。
- `workflow-live.js` 已占用 "journal.jsonl" 文件名（ultraAgent 运行日志，不同路径无冲突）——S0 文档做一行消歧。

**客户端**
- delta 重建在浏览器端；冷批量/live SSE 两路径有 parity 测试。适配器逐字段契约：`${timestamp}|${url}` 键、`mainAgent`/`teammate` 双标、`inProgress`、user_id 原样、`_isCheckpoint` /clear 语义、`_inPlaceReplaceDetected` 成对、哨兵条目；绝不发 `_staleReorder`/`_reconstructBroken`。
- tools/system 全量渲染 + 相邻请求 tools-diff（`ContextTab.jsx:378-427`）；`entry-slim.js:237` 历史回归 = blob 层同类风险的现成探测器。intern 池（`_toolsPool`/`_systemPool`）可复用为 ref 解析缓存。按需加载先例：`loadColdSession`/`loadMoreHistory`。
- IndexedDB（移动多标签）是 v1 形状 → S7 用**新 object store** 且受读侧 flag 门控（服务端回滚无法回滚客户端库，F11）。

**约束**
- Node `>=20.14`（排除 node:sqlite，维持纯文件）。测试 `node --test` 两档（test / test:cli=CI）；无 .jsonl golden fixture；本机 stub 首执行 ~3s 慢（flaky 记忆）。`files` 数组：`server/` 已覆盖，新顶层文件须显式加。数据丢失 catch → `reportSwallowed`；i18n 双文件；history.md；English comments；commit/publish 先征询用户。无磁盘空间守卫（grep 0 hits）。

## 核心设计决策（评审 P0 裁决）

1. **【F6 裁决】对话文件存 wire 事件（增量日志），物化放读侧。** 每行 = 一次 API 事件带来的新增 messages 切片或控制行（clear-epoch/compact-continuation/replace-tail），**每行携带发起 seq + requestId**（F8：物理落盘序 ≠ seq 序，读侧凭 seq 还原）。理由：写侧保真（存 wire 原貌，仅 blob 去重），写侧错误可事后在读侧修复；物化写（materialized）会把 reverse-anchor/merge 逼进写路径，一错即永久损坏。**S7 的承诺相应调整**：浏览器端复杂度（重建/逆锚合并/边界启发式）迁移为**一处共享物化器**（服务端/共享模块），从浏览器删除但不从代码库消失；按对话隔离使其大幅简化。
2. **【F7】S1 共享模块除边界谓词外必须包含 `findReverseAnchor`**（§3.1 plan-mode 短窗口、§3.2 K 尾重叠的唯一解法），物化器依赖它。
3. **【F1/F2】写序与目录协议**：`mkdirSync(recursive)` 先于首次 enqueue（异步 mkdir 会输给 microtask drain → ENOENT 被吞）；写序 blob →（fsync blob）→ conversation 行 → journal 行最后落；崩溃只留孤儿 blob，不留悬空引用；读侧容忍暂缺（pendingTail 思路）。**fsync 加在 blob/关键屏障上，不是 journal**。
4. **【F9】双 kill switch**：`CCV_WIRE_V2`（写）与 `CCV_WIRE_V2_READ`（读）独立，读侧默认 v1 直至验证通过；任何时刻可各自回退。
5. **【F15】teammate 归属**：v2 下 teammate 会话进自己的 session 目录，meta 记 leader sid + agentName；**适配器读取时按 leader 视图 re-join**（v1 的 leader 文件含 teammate 条目，S4 对比必须先做同样的 join，否则结构性误报掩盖真 bug）。
6. **【F13/F10】真实数据安全**：findcc.js L1 屏障只在测试上下文生效；生产路径新增独立防护——目录操作白名单（仅允许 session-dir 契约内路径，convKey 组件白名单防注入 F14）、destructive 操作走回收站式软删、转换器**严格只增**（绝不 unlink/改写 v1 树，默认 dry-run，验证期输出到独立根目录）。

## v2 存储格式

**权威定义见 `docs/refactor/WIRE_FORMAT_V2.md`（S0 已定稿，0b5a87d 起）**——本节原为 S0 前草案骨架，与定稿存在多处偏差（responses.jsonl 单文件而非 per-seq、journal 两相 req/done 行而非单行改写、`wireFormat` 无下划线等），为防新 session 被误导已移除，schema 一律以规范文档为准。要点速记：placeholder 由零 body 的 journal req 行取代；周期 checkpoint 删除（epoch 文件自足）；/clear=新 epoch；/compact=同 epoch 控制行。

## 分步计划

每步完成标准 = 自动化测试绿 + 处于可暂停态。S3 起须声明该步回滚路径。

### S-1 跨 session 追踪落地（计划批准后立即）
- **进度表放仓库**：`docs/refactor/WIRE_FORMAT_V2_PLAN.md`（本计划全文 + 步骤状态表：步骤｜状态 ⬜/🔄/✅｜日期｜commit｜下一步动作），每步 commit 时更新——仓库是真相源（压缩上下文/记忆召回失败时可自恢复）。
- **记忆只存断点指针**：`wire-format-v2-progress.md`（type: project）：一行"resume at S<N>" + 计划文档路径 + 关键 flag 名；加 MEMORY.md 索引。
- **恢复协议**：session 开始 → 读记忆指针 → 读仓库计划状态表 → **先跑上一完成步的 named tests 确认仍绿** → 再开工。

### S0 协议定稿（纯文档）
`docs/refactor/WIRE_FORMAT_V2.md`：完整 schema（含 journal 行、wire 事件行、控制行、meta）、寻址/URL 新契约、v2→v1 适配逐字段映射表、§3.1–§3.7 逐窗口对策（§3.1/§3.2→读侧逆锚物化；§3.3→控制行；§3.4→epoch；§3.5→continuation 控制行；§3.6→消除；§3.7→发起 seq）、写序/fsync/mkdir 协议、双编码 user_id 解析规范、teammate re-join 规则、IM worker 决策（初期 IM 进程 `CCV_WIRE_V2=0` 固定 v1，S6b 一并接入）、`downloadLog` v2 契约（rebuilt=适配器合成 jsonl；raw=session 目录 zip）、与 workflow-live 的 journal.jsonl 消歧、保留期策略（v1 存量与双写副本的清理由用户 S9 后决策）。完成标准：用户评审通过。

### S1 共享边界+逆锚模块（v1 行为零变化）
- `src/utils/clearCheckpoint.js` **移动**（非重写）为共享模块（`server/lib/session-boundary.js`，src 侧留 re-export 壳），沿 delta-reconstructor CLIENT-SAFE 先例；**entry-slim 3 处故意分化的副本保持原样**（只换 import 源，不统一公式）。
- `sessionMerge.findReverseAnchor` 同步抽入共享模块（供未来物化器用），客户端改 import。
- 消费方全覆盖：sessionManager/sessionMerge/entry-slim/contentFilter。
- 测试：现有 parity 测试全绿 + 新增共享模块单测。文件：新 `server/lib/session-boundary.js`；改 4 个 src/utils 消费方；新 `test/session-boundary.test.js`。

### S2 v2 核心库（纯新增，不接线）
- `server/lib/v2/`：`layout.js`（路径契约/白名单/meta 原子创建/mkdirSync 前置）、`blob-store.js`（CAS + fsync 屏障）、`journal.js`（发起序 seq、inflight→done 策略）、`conversation-store.js`（wire 事件行 + seq 佩戴 + 控制行 + epoch 切分）、`identity.js`（**双编码 user_id 解析**、convKey：tool_use.id 优先/指纹 fallback/兜底、teammate meta）、`v2-writer.js`（编排 + 写序协议 + reportSwallowed + 磁盘空间守卫 + AsyncWriteQueue 显式 path 变体）。
- `async-write-queue.js`：加显式 path append 变体（保空 path no-op）；评估 journal 独立队列实例（HOL，P2）。
- 单测：崩溃截断、并发、无 metadata 兜底、同 prompt 并行 subAgent（tool_use.id）、/clear→epoch、/compact→continuation、双编码解析、路径注入拒绝。完成标准：单测全绿，interceptor 零改动。

### S3 双写接入（v1 逻辑不改）
- 6 个落盘点收敛 `writeEntry()`（sentinel 不进 seam）；在 :839 前用 :773 的 `messages` 原始引用喂 v2；`CCV_WIRE_V2=1` 开启（默认关）；v2 失败 `reportSwallowed('v2-write')` 绝不影响 v1；journal seq 与 `_seq` 同一同步段；生命周期挂点接 v2 session 切换；声明 `_temp.jsonl` 的 v2 等价物（v2 无重放暂存需求→明确记录"无需等价物"或设计之）；ENOSPC 前置检查。
- **自动化完成标准（评审 #9）**：内联 fixture 驱动双写测试——断言 v2 目录形状正确、v2 写故障不影响 v1、现有 interceptor 全系测试不动全绿。**soak（本机日常开双写）单独标记为人工闸门，跨到 S4**。
- 回滚：`CCV_WIRE_V2=0`。

### S4 一致性校验工具 + 双写验证期（人工闸门）
- `server/lib/v2/verify.js` + **`ccv verify` CLI 子命令**（cli.js 挂接，npm script 仅是别名——npm 全局用户无源码仓库）。
- **闸门方法论（修 F12 盲区）**：① 会话级块指纹对比（沿用 fp 规则）；② **逐请求 tools/system 字节级对比**（blob 归属回归探测）；③ **live 增量轨迹对比**（对 watcher 喂出的中间态序列 diff，非只比冷态终值）；④ teammate 先做 leader re-join 再比（F15）；⑤ inflight/error 行数核对。
- 捕获一份**脱敏小型真实数据 fixture 提交 test/**（评审 #10），S5/S8 golden 可在新 session/CI 复现。
- 完成标准：连续 ≥5 个活跃日按上述 5 项全零差异；每日结果记入仓库状态表。发现差异只修 v2。

### S5 v2→v1 适配读层
- `server/lib/v2/adapter.js`：journal+conversations+blobs → v1 形状 raw entry 流（epoch 起点合成 checkpoint、其余合成 delta+seq、回填 blob、teammate re-join、合成哨兵；内存有界——大 epoch 的 checkpoint 合成流式化，F16）。
- `log-stream.js` 两 generator 分支（isV2SessionDir 分派）；受 `CCV_WIRE_V2_READ` 门控（默认关）。（原计划的 jsonl-archive resolveLogSource 泛化随归档功能移除作废。）
- golden：S4 fixture 断言两源重建全等。完成标准：**直连 URL 人工验证**（`/api/local-log?file=<v2寻址>` 完整渲染 + tools-diff 抽查）；完整 UI 入口留给 S6a。
- 回滚：`CCV_WIRE_V2_READ=0`。

### S6a 列表/管理/寻址切换
- `listLocalLogs` 输出 session 目录项（新寻址契约、meta 归属过滤替代 pid 文件名前缀、双实例并发测试）；**`workspace-registry.getWorkspaces` v2 计数**（走 sessions/*/meta 或 journal 尺寸）；delete 适配（destructive 走软删回收站 + 白名单;merge/archive 功能已于 2026-07-14 整体移除,无需适配）；`downloadLog` 按 S0 契约（rebuilt=适配器合成 jsonl / raw=目录 zip）。
- 完成标准：前端可从列表选中 v2 会话端到端浏览（补齐 S5 的 UI 闭环）。

### S6b live watcher + IM 接入（单独一步，最高风险）
- `log-watcher.js` 新增 v2 增量 tail（watch journal+conv 文件 → 现有 `createIncrementalReconstructor` 等价回调）；v1 watcher 并行保留；gap/rotation 系列测试移植。
- IM 体系接入：`im-log-watcher.js` + `im.js findRecentLog` 的 v2 等价（此前 IM 进程固定 v1 的临时决策在此解除）。
- 完成标准：双写下 live 流式从 v2 源驱动，与 v1 源并跑轨迹一致（S4 ③ 方法复用）。

### S6c 统计与残余
- `stats-worker.js` 读 v2（缓存按 journal offset 重键）；`readHeadRotationContext` → meta/journal；退役死代码（readLogFile/readLocalLog/migrateConversationContext）。

### S7 客户端原生 v2（7a/7b 可拆）
- 7a：v2 数据通道（journal 列表 → 按需 conversation/blob，扩展 loadColdSession/loadMoreHistory；blob 解析复用 intern 池）；session 身份切真实 session_id（重接 getSessionStableId/buildSessionIndex/pin/splitHotCold）；**IndexedDB 新 object store + 读 flag 门控**。
- 7b：v2 路径绕过 entry-slim/sessionMerge（物化收敛到共享物化器；v1 legacy 查看走旧路径，代码分叉不删除）。
- i18n 双文件补 key；两路径 parity 测试迁移全绿。

### S8 v1→v2 转换工具（存量 4.2GB）
- `server/lib/v2/convert.js` + **`ccv convert` 子命令**：复用现有 `reconstructEntries` 物化会话再写 v2 事件流（不重实现 wire 语义）；**双编码 user_id 解析**；**严格只增**（绝不动 v1 树，默认 dry-run，先输出独立根目录校验后再入正式位）；幂等+可续传（文件+offset 进度）；空间断言（≥2×源）；单文件流式、RSS 预算（F16）。
- golden：转换后经适配器重建 == 源文件直读重建（S4 方法论全项）。

### S9 v1 写入下线 + 收尾 + 一次性发版
- `CCV_WIRE_V2`/`CCV_WIRE_V2_READ` 默认开，v1 写停（读能力保留）；legacy 路径标注；README 全语言、history.md、`docs/WIRE_FORMAT.md` 标 superseded；v1 存量/双写副本清理方案交用户决策（F5：不擅自删）。
- 全量 `npm run test:cli` + `npm run build`；**征询用户后** commit/publish（此时才动版本号）。

## 风险与缓解（评审后修订）

| # | 风险 | 缓解 |
|---|---|---|
| 1 | 物化写入把 merge 错误永久化 | 【已裁决】存 wire 事件+读侧物化（F6）；逆锚入共享模块（F7） |
| 2 | journal 记完成序复活 §3.7 | seq 发起时赋值；conversation 行佩戴 seq+requestId（F8）；移植 delta-reorder 不变式 |
| 3 | S4 闸门盲区（tools 归属/live 轨迹/teammate join） | 五项方法论（字节级 blob 比对、轨迹 diff、re-join 后比） |
| 4 | 崩溃悬空引用（无 fsync） | mkdirSync 前置；blob→conv→journal 写序，fsync 加在 blob 屏障（F1/F2） |
| 5 | 读侧无独立回退 | `CCV_WIRE_V2_READ` 双开关（F9） |
| 6 | 真实数据破坏（转换器/删除/合并） | 只增不变式+dry-run+独立根目录；软删回收站；路径白名单；L1 屏障不覆盖生产的事实已知（F10/F13/F14） |
| 7 | teammate 归属结构性误报 | 适配器 leader re-join 规则 S0 定稿（F15）；proxy 模式沿现状文档化 |
| 8 | live tail 移植回归 | S6b 单列、v1 watcher 并行、轨迹对比 |
| 9 | 双写磁盘翻倍+ENOSPC 静默 | 空间守卫+reportSwallowed+写侧开关逃生 |
| 10 | 遗漏消费方静默坏死 | workspace-registry/IM/download 契约已入 S6a/S6b/S0；死代码退役清单 |
| 11 | 转换器 4.2GB 正确性/内存 | 复用现有重建器、幂等续传、流式+RSS 预算、golden 全项 |
| 12 | 跨 session 断点丢失 | 进度表入库为真相源、记忆只存指针、恢复协议先验证上步测试 |

## 验证（整体）

1. 每步自动化测试 + `npm run test:cli` 全绿（含 S4 起的脱敏真实 fixture golden）。
2. S4 五项方法论 ≥5 活跃日零差异（人工闸门，逐日记录入库）。
3. 端到端人工点：冷加载、live 流式、session 切换/pin、tools-diff、/clear 与 /compact 边界、teammate 面板、IM 会话、下载（raw/rebuilt）、删除（软删;合并/归档功能已移除）、workspace 列表计数、移动端。
4. 体积指标：双写期实测 v2/v1 体积比 ≤10%。
5. S9 前完整回归 + 用户验收后才 publish。
