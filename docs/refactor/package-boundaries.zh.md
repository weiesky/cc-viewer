# packages/app 分层与 import 边界契约

> 执行：`node scripts/verify-boundaries.mjs`（`pnpm run verify:boundaries`）。
> 例外清单：`scripts/boundary-allowlist.json`。本文档是规则的人类可读版本；
> 机器可读版本以检查器源码为准（fail-closed，未分类文件即失败）。

## 为什么有这个 gate

`packages/app` 的目录布局就是 npm tarball 布局（server 以原始 ESM 源码发布、无构建步骤、
内部包不发布），因此**物理拆包**受发布契约硬约束（迁移计划 §1.2 已否决包名 import 与
import 改写 codemod）。在物理拆包可行之前，先保证**逻辑分层**成立：

1. 现存循环依赖全部解开（静态环为 0）；
2. 子系统边界显式化、由 CI 执法，不再越退越多；
3. 每个子系统达到「随时可物理拆」的就绪状态。

## 分层模型

| 层 | 路径 | 允许 import |
|---|---|---|
| CORE | `packages/core/src/**`（@ccv/core —— 私有 workspace 包，经 bundledDependencies 打进 tarball） | 仅 CORE / builtins（R8 硬规则；当前 12 文件零 builtins） |
| L0 | `findcc.js`、`server/_paths.js`、`server/i18n.js` | L0 / L0-leaf / CORE / node builtins |
| L0-leaf | 精选纯叶子清单（检查器内 `L0_LEAVES`） | 闭包不变量：传递闭包不得越出 L0 ∪ L0-leaf ∪ CORE ∪ builtins ∪ deps |
| L1-lib | `server/lib/**` 散文件（默认类） | L0 / L0-leaf / CORE / L1（lib+子系统）；不得引 L3/L4；引 L2 须 allowlist（R5） |
| L1-sub | `server/lib/{v2,ask,im,adapters,proxy}/` | 同 L1-lib，另加：不得跨子系统（`adapters` 与 `im` 同组——未来同一个包） |
| L2 | `server/{interceptor,proxy,pty-manager,scratch-pty-manager,workspace-registry}.js` | L0/L1/L2/CORE（目标态，gate 暂未对 L2 出边执法） |
| L3 | `server/routes/**` | L0/L1/L2/CORE（目标态，gate 暂未对 L3 出边执法） |
| L4 | `server/server.js`、`cli.js`、根 shim | 任意（组合根；仅受 R1 环约束） |
| WEB | `apps/web/src/**` | **不得引 packages/app**（R6 全禁）；跨包共享一律 `@ccv/core/<name>` |

> 注：L2/L3/L4 行的「允许 import」列是分层目标态——gate 当前只对 L0/L0-leaf/L1/WEB
> 的出边执法（R2–R6），L2/L3/L4 出边仅受 R1（无环）约束。表中规则以检查器源码为准。

## 规则

- **R0**（硬）：L0-leaf 闭包不变量（每个叶子的传递闭包不得越出 L0 ∪ L0-leaf ∪ CORE ∪ builtins ∪ deps）
  + 清单条目必须存在于磁盘。
- **R1**（硬）：无静态环（SCC 检测）。动态 import 单独建表；动态闭合成环须 allowlist（`R1-dyn`）。
- **R2**（硬，不可豁免）：`server/lib/**` 不得引 `server/server.js`、`routes/**`、`cli.js`。
- **R3**：跨子系统边须 allowlist。
- **R4**（硬）：L0 只引 L0 / L0-leaf / CORE / builtins。
- **R5**：L1 引 L2 须 allowlist（引 L3/L4 永远由 R2 硬拦）。
- **R6**（硬，不可豁免）：web → packages/app **全禁**（@ccv/core 提炼后反转——原白名单
  「src/utils/* + L0-leaf」整体即 CORE）；web → `@ccv/core/<name>` 允许，且子路径必须
  映射到 `packages/core/src/` 真实文件（R7 的 @ccv/core 解析负责，fail-closed）。
- **R7**（硬）：相对 import 必须可解析；相对动态 import 必须字面量说明符；
  裸说明符必须是 builtins 或所属 package.json 已声明依赖（清单运行时读取）；
  `@ccv/core/*` 说明符额外必须命中真实 core 文件（无根导出）。
- **R8**（硬）：CORE 只引 CORE（共享同构基座的纯度；CORE 文件零裸说明符依赖，
  packages/core/package.json 零 dependencies）。
- **CLS**（硬）：fail-closed——被扫描的文件必须有所属层（未分类即失败）。

## 例外清单与棘轮

`scripts/boundary-allowlist.json` 是 `{from,to,rule,reason,since}` 的排序数组：

- 新增例外 = 手工编辑 + 写明 reason/since，提交 diff 可审查；
- **stale 检测**：例外对应的违规消失（边被修掉或不再违规）→ gate 失败并提示
  `node scripts/verify-boundaries.mjs --write` 收缩清单。**清单只许收缩，不许静默扩张**；
- 硬规则（R2/R6）不接受例外。

当前例外（3 条，均为结构性）：

1. `interceptor.js →(dyn) server.js`（R1-dyn）——注入式 interceptor 自启动 viewer；
   转静态会制造真环（server.js 静态引 interceptor 的 13 个活绑定）。懒动态边本身就是 seam。
2. `workspace-registry.js →(dyn) lib/file-access-policy.js`（R1-dyn）——注册表失效 policy 缓存；
   反向静态边 policy→registry 已存在，转静态即成环。
3. `lib/file-access-policy.js → server/workspace-registry.js`（R5）——policy 读 registry 的
   loadWorkspaces 计算 allowlist roots。留待 registry/policy 拆分时处理。

## 未来物理拆包就绪清单

按就绪度排序（详见 A2 迁移计划 §1.2 的契约约束；任何物理拆包都需先解决
「tarball=原始源码」的打包回拷问题，@ccv/content 是已批准的先例模式）：

1. **ask/**（~1.0k LOC）：出边仅叶模块；`ask-bridge.js` 是独立子进程（纯 HTTP 契约）。
2. **im/+adapters/**（~3.2k LOC）：`registerAdapter` 已是插件钩子，4 个 IM SDK 全靠
   动态 import 隔离在 adapters/；需先处理 `cli.js runImMode` 与 server.js 的接线。
3. **v2/**（~5.7k LOC）：最大最自包含（WIRE_FORMAT_V2.md 已成文）；本轮已解开
   `log-management ↔ v2/adapter` 静态环。
4. **proxy/**（~1.3k LOC）：近叶子；`server/proxy.js` 本身与 interceptor 耦合，留在 app。

不适合拆：`findcc.js`（38 个消费者的地基）、`cli.js`（组合根）、`server.js`（宿主本身）。

## 本轮迁移记录（2026-08-19，@ccv/core 提炼）

- 原「4 文件共享缝」`src/utils/` + 8 个 web 共享 L0-leaf（server/lib 的 session-boundary /
  delta-reconstructor / v2-transcript-normalizer / context-rules / voice-pack-events /
  approval-modal-prefs / error-report / tools-xml-formatter）整体提炼为私有 workspace 包
  **@ccv/core**（`packages/core/src/`，12 文件，零 node builtins，闭包自洽）。
- 发布模型：packages/app 以普通版本号 `"@ccv/core": "0.0.0"` 依赖 + `bundledDependencies`；
  npm pack 跟随 pnpm workspace symlink 把 core 打成真实文件进 tarball（实证：npm 11.17.0），
  无 import 改写、无构建步骤、不新增发布包——§1.2 Phase C 的「等深目录拷贝」活口落地形态。
- dev 解析：`pnpm-workspace.yaml` 开 `linkWorkspacePackages: true`（普通版本号即可链本地包）；
  changesets 侧 `.changeset/config.json` 加 `bumpVersionsWithWorkspaceProtocolOnly: true` 让
  普通版本号内部依赖不进入版本图（否则 invalid-tree 报错）。
- **R6 反转**：web → packages/app 从白名单收紧为全禁；web 的跨包共享一律 `@ccv/core/<name>`。
  检查器新增 CORE 层（packages/core/src/**）与 R8（CORE 只引 CORE）；R4/R0 放行 CORE。
- import 改写量：packages/app 服务端 36 处 + apps/web 31 处 + scripts/ 1 处 + 测试 48 处
  （两个一次性 codemod：scripts/codemod-core-imports.mjs / codemod-core-test-imports.mjs，
  按 basename 解析式改写，用后删除）。
- 测试迁移：11 个主语测试迁 packages/core/test/（根 `node --test` 自动发现）；
  session-boundary/content-filter-unit/ultraplan-detection 等跨层集成测试留根
  （2026-08-19 全面入包后：session-boundary 已迁 packages/core/test/，留根者仅剩真正跨层者）。
- 兼容性说明：packages/app exports map 本就只暴露 `.` 与 `./interceptor.js`，src/utils 深路径
  非公开 API，硬切不留壳（零动态 import 已验证）。

## 本轮解环记录（2026-08-19）

- `log-management.js ↔ v2/adapter.js` → 新叶子 `lib/log-file-utils.js`
  （`isLogFileName`/`parseLogTs`/`LIVE_SESSION_MTIME_MS`；log-management re-export 兼容）。
- `model-system-prompts.js ↔ system-prompt-files.js` → `isNonEmptyFile` 下沉 `lib/file-api.js`。
- `findcc →(dyn) file-access-policy` → `onLogDirChange` 注册表反转（policy 模块加载时注册）。
- `lib/project-prefs.js → server/interceptor.js` → 新有态叶子 `lib/project-state.js`
  （interceptor 在模块初始化/`initForWorkspace`/`resetWorkspace` 三处推值）。
- `ask/perm-bridge.js → im/im-deny.js` → `im-deny.js` 提升为 `lib/` 根级共享叶子
  （原路径留 re-export 兼容壳）。

## 测试全面入包记录（2026-08-19）

- 推翻迁移计划 §7 决策 2「测试目录保留在根 test/」：测试按被测代码归属迁入各包
  `test/` 目录（packages/app、apps/web、apps/electron、packages/core、packages/content），
  根 `test/` 仅保留跨层集成测试与根级守卫；根 `node --test` 默认递归发现全部。
- 门禁扫描范围：各包 `test/` 目录不属于分层源码，`scripts/verify-boundaries.mjs` 的
  `EXCLUDE_DIRS` 新增 `'test'`（与既有 `scripts`/`dist` 同机制），不参与 classify。
