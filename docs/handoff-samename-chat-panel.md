# 交接：同名项目 [对话] 面板始终指向同一项目（跨目录同名会话隔离）

> 状态：**已知缺陷，未修复（刻意保留，避免更大 regression）**。本文件供新会话继续。
> 关联记忆：`memory/samename-project-fixes.md`、[[resume-multisession]]。
> 代码基线：本仓库工作区含一批**未 commit** 的同名修复（tab 消歧 / 只读路由 instanceKey / 纯客户端 viewing），全部 `patch` changeset。

## 一句话症状

两个不同 cwd 的同名项目（如 `/a/finqa-remote-cc` 与 `/b/finqa-remote-cc`）并行时，点另一个同名 tab，**文件浏览器与终端正确切换到对应目录，但 [对话] 面板内容不变**——始终显示同一个项目的会话。

## 根因（已实锤）

1. 两个同名项目**共享同一个 session 目录池** `<LOG_DIR>/<basename>/sessions/`：
   - `packages/app/server/lib/v2/v2-writer.js:169`、`:330` — `projectDir = join(this._logDir, sanitizePathComponent(project))`；
   - `project` 来自 `_resumeProject = projectKeyForCwd(cwd)`（:413-415），是 **basename**（`/a/finqa-remote-cc` 与 `/b/finqa-remote-cc` 都得 `finqa-remote-cc`）→ 物理上同一个池。
2. 池内会话靠 `meta.json` 的 `instance`（instanceKey）区分（`v2-writer.js:327`）。
3. 对话冷加载：`packages/app/server/routes/events.js:285`（回退后）
   `latestMainSessionDir(join(LOG_DIR, sanitizePathComponent(projectParam)), { skipForeignLive:true, instanceKey })`。
4. `latestMainSession`（`packages/app/server/lib/v2/session-select.js:271`）按 `meta.instance === instanceKey` 过滤（:292），**但 :306-314 有"无限制内容回退"**：
   - 目标实例有内容 → 用它；
   - 目标实例无内容 → 回退到 `newestWithMainTurn(projectCandidates)`（**项目池里任意 instance** 的最新有内容会话）→ 显示另一同名项目的会话。

文件树/终端**无此回退**（view-root 按 cwd / attachPtyFor 按 instanceKey），所以它们切换正确——这正是不对称的来源。

## 为什么不能简单删掉回退

回退是为 **同 cwd 双实例的多 agent 协同** 刻意设计的（用户拍板，见 §十二记忆）：同一 cwd 起两个 claude 实例，一个新鲜无内容时应显示另一个（协同兄弟）的会话。**删掉会破坏这个终极目标场景。** 用户明确要求兼顾。

## 已尝试的死路（不要重蹈）

**"按 cwd 收紧回退"（已回退，勿复原）**：给 `latestMainSession` 加 `targetCwd` + `resolveCandidatesCwd(meta)`，回退池过滤为 `cwd === targetCwd`。

- 思路：同 cwd 双实例（协同）两者同 cwd 都保留；跨目录同名他方 cwd 不同则排除。
- **为何失败**：**历史会话的 `meta.instance` 指向已死旧 instanceKey 或缺失**。bound 实例自己的历史会话（在其当前 instanceKey 之前、由旧进程/旧实例产生）meta.instance 对不上当前 live key，`resolveCandidatesCwd` 在 live 里查不到 → cwd=null → 被一并误排。结果 `latestMainSession(bound实例)` 误判"无会话" → 服务端发 `sid-not-found`(reason: instance-no-session) → 前端 `sid-not-found` handler（AppBase.jsx:1935）弹"切换超时" toast + `handleDetachView()` 把视图拉回 bound——**尽管后端随后通过 live feed 推了正确内容**。比原缺陷更糟（引入卡死感 + 误 detach）。
- 教训：同名共享池 + **历史会话无可靠 cwd 归属** ⇒ 任何"读时按 cwd 过滤候选"的方案都会误伤。`meta.cwd` 当时未落（且存量会话永远不会有）。

## 可行的根治方向（供新会话评估，需用户拍板）

先解决**"会话 → cwd 的可靠归属"**，再谈隔离。按侵入性从小到大：

**方向 A：session 写入端今后落 `meta.cwd`（增量，不动存量）**
- `v2-writer.js` `_session` 的 meta 增加 `...(cwd && { cwd })`（cwd 来自 `entry._resumeProjectCwd`，需在 interceptor 保留 `x-ccv-project-dir` 原始路径——目前 interceptor.js:984-988 只留 `projectKeyForCwd(dir)` 丢弃了原始路径）。
- 之后读时：`latestMainSession` 回退池过滤 `meta.cwd === targetCwd`；`meta.cwd` 缺失的存量会话 → 归入"未知"，策略需用户定（保守=允许=可能串，严格=排除=可能误伤存量）。
- 风险：存量会话仍无 cwd，混合期长；只对新会话精确。

**方向 B：session 池按 cwd 细分（改目录结构）**
- `projectDir` 从 `join(LOG_DIR, sanitizePathComponent(basename))` 改为按 cwd 派生（如附加 cwd hash）。
- 跨目录同名天然隔离；但**同 cwd 双实例仍同池**（协同保留）。
- 风险：**会改变存量会话的位置语义**（旧会话在旧池找不到）；迁移/兼容成本高；需明确"同 cwd 协同"是否依赖同池（依赖则安全，因同 cwd 仍同池）。

**方向 C：接受现状，仅在 UI 上标注**
- 对话面板顶部标注"当前显示的是 <cwd> 的会话"，让用户知道指向哪个项目；不做数据隔离。
- 成本最低，治标。

**前置问题（建议先问用户）**：同 cwd 多 agent 协同是否**强依赖**两个实例共享同一 session 池？若依赖 → 方向 B 安全、方向 A 兼容；若不依赖（协同在别处实现）→ 可选更彻底的按 cwd 分池。

## 相关文件锚点（回退后现状）

- 池与写入：`packages/app/server/lib/v2/v2-writer.js:169`、`:296`(`_session` 签名)、`:327`(meta.instance)、`:330`(projectDir)
- 选择/回退：`packages/app/server/lib/v2/session-select.js:271`(`latestMainSession`)、`:292`(instance 过滤)、`:306-314`(内容回退)
- 冷加载入口：`packages/app/server/routes/events.js:283-292`(instance 分支)、`:307-310`(instanceNotFound→sid-not-found)
- 前端 sid-not-found：`apps/web/src/AppBase.jsx:1935-1940`
- 测试：`packages/app/test/v2-session-select.test.js`（instance 过滤/回退既有用例；cwd 收紧用例已随回退删除）

## 已落地的相关修复（勿回退，与缺陷共存）

- tab `[1]/[2]` 消歧（`resumeSessions.js applySameNameIndex` + `.projectTabIdx` span）。
- 只读路由 instanceKey 消歧（`view-root.js resolveViewRoot instanceParam` + `apiUrl.js withViewParams`）——文件树等不再 "ambiguous project name"。
- Bug1+3 纯客户端 viewing（`currentInstanceKey` + `resolveBoundInstance`）——bound tab 点击即单高亮。

## 验证方式

1. 起两个不同 cwd 的同名项目（如 `/a/finqa-remote-cc`、`/b/finqa-remote-cc`），各发一条消息。
2. tab 条出现 `finqa-remote-cc [1]` / `[2]`。
3. 切换两 tab：文件树/终端应跟随；[对话] 面板**当前始终指向同一个**（即本缺陷）。
4. 修复目标：切换后对话面板也跟随到对应项目的会话，且**不引入** sid-not-found toast / 误 detach / 同 cwd 协同失效。
5. 必跑：`pnpm run test:web`、`pnpm run test:cli`、`pnpm run build`、`pnpm run verify:boundaries`；并**真机**验证（单测镜像测不出时序/SSE 类回归——本轮教训）。
