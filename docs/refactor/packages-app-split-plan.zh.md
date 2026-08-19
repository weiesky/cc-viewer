# packages/app 分拆方案（阶段一调研结论 + 阶段二设计）

> 状态：阶段一（调研）已完成并评审；阶段二（L4 门禁 + content 外移 + lib 批 1 重组）按本文执行。
> 调研方式：4 个并行调研 agent（结构盘点 / 依赖图 / 发布契约 / 候选设计）+ 3 个对抗评审 agent（证伪 / 契约复核 / 价值挑战）。
> 前置文档：`docs/refactor/pnpm-monorepo-migration-plan.zh.md`（A1–A3 迁移方案，§0.1 契约、§1.2 不拆理由为设计基线）。

## 0. 结论速览

| 路线 | 内容 | 工作量 | 风险 | 解决痛点 |
|---|---|---|---|---|
| **Axis-2** | `server/lib/` 91 个平铺文件 → 语义子目录（原地重组） | M（分批） | 低-中 | 导航（唯一解） |
| **A** | 资产目录 → `packages/content` | S（0.5–1d） | 低 | 仓库卫生 + 机制演练 |
| **B1** | 运行时整体 → `packages/runtime` | M（2–3d） | 中 | 名义独立演进（推迟） |
| **C'** | relay 技术细粒度分包 | L | 中-高 | 真模块化（归档待驱动） |

**阶段二 = Axis-2 批 1 + A + L4 基线自动化（3 个独立 commit）。**

## 1. 阶段一调研关键事实

- 代码总盘：158 个 JS / 43.4k LOC；`server/lib/` 91 文件 18.7k LOC 平铺是最大导航痛点。
- 运行时载荷 R = server/ + cli.js + findcc.js + 根 shim + src/utils 4 文件缝，在**纯搬移**语义下是强连通分量（megacycle routes↔server.js↔interceptor.js；findcc.js 被 38 文件引用；cli.js 传递闭包 = 整个 server；缝双向引用）。
- 但 relay 技术（仓库侧 re-export 壳、永不进 tarball，先例：`apps/web/src/utils/errorReport.js`）使任何切口物理可行——评审证伪了"不可再切"的原判。可行性不是瓶颈，价值排序才是。
- relay 路线的真实代价：relay 树的双胞胎文件困惑、pack 需 staging 聚合、聚合逻辑要在 assemble-dist 与 assemble-app 两处实现、11 处 `import.meta.url` 锚文件只能 relay 不能复制。

## 2. 新发现的硬约束（补充 §0.1）

1. `server/system-prompt-templates/` 被 `create_system_prompt.js` 的 `new URL(..., import.meta.url)` 钉死在 server/ 下，不能进 content 包。
2. Electron 深路径面 = 9 个载荷模块 + `main.js`/`tab-worker.js` 的 rootDir 探测硬编码 `packages/app` 回退。
3. `cli.js --version` 的版本读取失效会卡死 homebrew formula 的 test block（发布阻塞级）。
4. `server.js` 的 SERVER_BUILD 版本读取若错读，前端过期 bundle 自愈机制静默失效。
5. 用户 settings.json 里 4 个 `server/lib/*-bridge.js` 绝对路径是 de-facto 公共 API；`ensure-hooks.js` 有 existsSync 自愈重写（最坏一次启动静默降级）。
6. 全仓库无 readdir 枚举 `server/lib/` 或 `routes/` —— lib 内部分组无枚举隐患。
7. L4 契约门禁此前无基线、无自动化（A2 为人工一次性比对）——本方案 Commit 1 补齐。
8. 测试提速与分拆无关：实测单测 9,097 例/23.2s、CLI 层 9,485 例/34.3s，node --test 已文件级并行；提速走 CI 分片/套件分层独立专项。

## 3. 阶段二设计（3 个 commit）

### Commit 1 — L4 tarball 契约门禁

- `scripts/verify-tarball-contract.mjs`：`npm pack --dry-run --json --ignore-scripts`（先显式 assemble；`--ignore-scripts` 防 prepack 输出污染 JSON）取文件清单；剔除 `dist/assets/*`（hash 名不稳定），断言 `dist/index.html` 与 voice-packs 存在；与 `scripts/tarball-baseline.json` 比对，diff 非零退出；`--write` 重建基线。
- ci.yml 在 build 与 test:cli 之间插入 `pnpm run verify:tarball`。

### Commit 2 — 资产目录外移 `packages/content`（@ccv/content, private, 0.0.0）

- `git mv`：concepts/、ultraAgents/、server/imPreset/、server/imSkills/ → packages/content/（保持两级深度：根级与 server 级）。
- `_paths.js` 4 个常量改探测式，**content 包优先**（生产 tarball 无 `../content` 自然回退），各带结构 sentinel 防同名误命中。
- `assemble-dist.mjs` 扩展拷贝 4 目录（幂等、缺失即 throw）；`.gitignore` 忽略 app 内组装产物。
- 影响面：3 个直引资产的测试改指；electron 零改动（assemble-app 先跑 assemble）；changesets 规则措辞扩到 packages/content。
- L4 预期**零 diff**。

### Commit 3 — Axis-2 批 1（21 文件）

- `server/lib/im/`（12）：im-* ×10 + dingtalk-bridge + dingtalk-config（注：dingtalk-bridge 非孤儿，routes/dingtalk.js 引用）。
- `server/lib/ask/`（5）：ask-store / ask-reaper / ask-constants / ask-bridge / perm-bridge。
- `server/lib/proxy/`（4）：proxy-retry / proxy-stats / proxy-env / proxy-errors。
- codemod 改写：簇外引用方加子目录段；被移文件的簇外引用加一层 `..`；特殊锚点 2 处（im-process-manager 的 CLI_JS 深度、ensure-hooks 的 2 处 bridge join）。
- 测试 codemod ~50 文件；web 零改动（批 1 不含 CLIENT-SAFE）；c8 glob 递归无需改。
- L4 基线重建：预期恰好 21 删 + 21 增，逐条人工核对。

## 4. 阶段三议程（已确认立项讨论）

B1 去留（runtime 整体搬移，当前裁决：边界无强制力、推迟到真实驱动）；C' 深入评估（relay 治理、staging pack）；降阻重构（routes 依赖注入 / `_paths.js` 解锚（CCV_PACKAGE_ROOT 环境变量优先）/ src/utils 缝迁入 server/lib/shared）；测试提速专项。

## 5. 后续批次备忘（Axis-2 批 2+ 候选）

hooks 簇（ensure-hooks + turn-end-bridge + session-start-bridge）、pty 簇（pty-manager 链 + terminal-env 等）、log 簇（log-stream/log-watcher/log-management/log-zip）、system-prompt 簇（create_system_prompt 链 + model-system-prompts + spawn-model-resolver）、adapters 迁入 lib/im/adapters/。每批沿用批 1 的 codemod + L4 重建流程。
