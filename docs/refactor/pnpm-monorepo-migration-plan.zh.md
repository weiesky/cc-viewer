# cc-viewer: npm → pnpm 迁移 + Monorepo 拆包方案（v1.0，评审修订版）

> 状态：方案设计文档，不含代码改动。本版已整合 3 路评审（代码事实 / 发布链路 / pnpm 生态）的全部 P0、P1 与关键 P2 修正。
>
> 决策输入（用户已确认）：
> 1. **内部拆分、单包发布** —— workspace 内部按功能拆包，npm 上仍只发布 `cc-viewer` 一个包；
> 2. 内部包命名 **`@ccv/*` scope**（`@ccv/web`、`@ccv/electron`），`private: true`，不上 npm —— scoped 私有名即使误执行 publish 也会被 npm 默认 restricted 拦截，多一层防误发布保险；聚合发布包仍是 `cc-viewer` 不变；
> 3. 版本策略：Changesets（评审后对「独立版本」做了修正，见 §2.4）；
> 4. 路线图：同时给出「渐进式」与「一步到位」两种（§3）。

---

## 0. 现状关键事实（探索 + 评审复核结论）

### 0.1 发布产物契约（迁移的真正不变量）

npm tarball 的**物理布局是公共 API**，不能变：

| 契约 | 证据 | 破坏后果 |
|---|---|---|
| `bin: { ccv: cli.js }` | package.json | 全局安装命令失效 |
| `exports: "." → ./server.js`、`"./interceptor.js" → ./server/interceptor.js` | package.json + 根 shim | 程序化引用失效 |
| **注入标记** `import 'cc-viewer/interceptor.js';`（新版）与 `import '../../cc-viewer/interceptor.js';`（遗留）写入**用户机器上**的 claude cli.js | `findcc.js:270,283`；静态锁定在 `test/cli-inject.test.js:171-175`、`test/cli-import-paths.test.js:116`；shim 锁定在 `test/root-shim.test.js` | 所有未升级老用户 `claude` 启动即崩 |
| `files` 数组：`dist/ server/ src/utils/ cli.js findcc.js server.js interceptor.js plugins/ concepts/ ultraAgents/` | package.json | 运行时缺文件 |
| `server/` 以**原始 ESM 源码**发布（无构建步骤） | — | bundle/改写均有回归风险 |
| `server/_paths.js` 位置敏感（`PACKAGE_ROOT = resolve(HERE,'..')`，文件头自带警告） | `server/_paths.js:1-30` | 移动即静默错路径 |
| 运行时自读 `package.json`（updater、`__APP_VERSION__`、SERVER_BUILD） | `vite.config.js:13`、`server/lib/updater.js:51`、`server/server.js:344` | 版本号来源必须保持单一 |

### 0.2 跨界面（拆包的最大结构障碍，评审后修正）

- **server → src**（2 处）：`server/lib/v2/live-feed.js:35`、`server/lib/v2/meta-rows.js:25` 引用 `src/utils/requestType.js`。经评审验证，server 端运行时闭包 = **`requestType.js` + `contentFilter.js` 两个文件**（requestType 只 import `./contentFilter`，自包含）。
- **src → server**（8 处）：`server/lib/{voice-pack-events, approval-modal-prefs, delta-reconstructor, tools-xml-formatter, context-rules, session-boundary, error-report, v2-transcript-normalizer}.js`，均带 `// CLIENT-SAFE` 横幅，由 `test/client-safe-imports.test.js` 白名单锁定。
- **评审修正**：`src/utils/` 共 95 个文件，其中 5 个 import `../i18n`、2 个 import `../img/*`、1 个 import `../hooks/*` —— 整个目录**不能**简单留在 server 侧。正确切法见 §1.2：app 只保留 2 文件闭包，其余 93 个随 web 走（它们的相对 import 全部在 web 内部闭合，零改写）。

### 0.3 依赖与 pnpm 敏感点（评审复核）

- **幻影依赖：0 个**（全树扫描干净）。
- lockfile 中带 install 脚本的包共 **6 个**：`node-pty`（native，硬性需求）、`esbuild`、`protobufjs`、`es5-ext`、`electron-winstaller`、`fsevents`（macOS watcher，屏蔽后降级为 fs.watch）。`electron@42` **无** postinstall（scripts 为空，二进制走 lazy bin），`@electron/rebuild` 也无 install 脚本 —— 二者不进白名单。
- `overrides`（axios / qs / node-gyp@^12.1.0）→ 平移到 `pnpm-workspace.yaml` 的 `overrides:`（v11 兼容写法）；**node-gyp 覆盖是 Windows VS2026 electron 构建的承重墙**。
- `dompurify` 误列在 `dependencies`（纯前端用）→ 拆包时纠正到 web 的 devDependencies。
- `engines: node >=20.14.0` 名不副实：undici 7 要 ≥20.18.1（runtime floor）；electron 42 要 ≥22.12；测试用 `module.registerHooks`（Node 23.x+，CI 跑 24）。
- 测试 ~473 文件：bare import 扫描发现根测试直接 import `ws`(5)、`react`(3)、`adm-zip`(3)、`undici`(2)、`marked`(2)、`@xterm/xterm`(1)，另有 `node-pty`、`dingtalk-stream`、`@anthropic-ai/claude-agent-sdk` —— pnpm 严格隔离下这些必须在根 package.json 显式声明（见 §2.1）。
- `pnpm import` 存在保真性失败模式（pnpm/pnpm#6233：静默忽略 lockfileVersion 3 并重解析到 latest）→ 必须做全量版本 diff 门禁（§4 L0）。

### 0.4 pnpm 版本策略（评审后修正）

pnpm 11 已发布且稳定（v11 配置全部集中于 `pnpm-workspace.yaml`，`package.json#pnpm` 不再读取）。**已拍板：钉迁移日 latest 11.x** —— 本方案所有配置一律写进 `pnpm-workspace.yaml`，若 11.x 遇生态兼容问题回退 10.x 最新也只需改 `packageManager` 字段一行（10↔11 的官方 codemod 可兜底）。注意：Corepack 已从 Node ≥25 发行版移除，本地开发环境准备需写进 CLAUDE.md（CI 用 `pnpm/action-setup@v4`，不受影响）。

---

## 1. 目标架构

### 1.1 包划分（1 个发布包 + 2 个内部包 + 根编排壳）

```
repo-root/
├── pnpm-workspace.yaml          # packages + onlyBuiltDependencies + overrides + catalog
├── package.json                 # private 编排壳：根 scripts、c8、engines、packageManager、测试用 devDeps
├── pnpm-lock.yaml               # 唯一 lockfile
├── .changeset/                  # Changesets 配置（只管 cc-viewer 一个包，见 §2.4）
├── test/                        # 全部测试保留在根（§3.3）
├── docs/ site/ homebrew/ scripts/   # 不动（scripts 内个别路径修正，§3.2-7）
├── packages/
│   └── app/        → 发布名 cc-viewer（唯一发布包；仓库布局 == tarball 布局）
│       ├── cli.js  findcc.js  server.js  interceptor.js   # 根 shim 原样保留
│       ├── server/            # 后端全部（i18n.js、_paths.js、routes/、lib/、imSkills/、imPreset/、system-prompt-templates/）
│       ├── src/utils/         # ★ 只含 4 文件运行时闭包（requestType/contentFilter/teammateDetector/clearCheckpoint —— A2 实施时验证的传递闭包，比方案初稿的 2 文件多 2 个）
│       ├── plugins/ concepts/ ultraAgents/
│       ├── dist/              # pack 时由 apps/web/dist 拷入（gitignore，prepack 钩子）
│       ├── scripts/assemble-dist.mjs
│       └── package.json       # name: cc-viewer；files 数组与今天一致；engines >=20.18.1
└── apps/
    ├── web/        → @ccv/web (private, version 静态)
    │   ├── src/               # 前端 ~61k LOC（含 i18n.js + 93 个 utils 文件）
    │   ├── public/            # ★ 从根迁入（vite 默认 publicDir，dist 内容不变）
    │   ├── index.html  vite.config.js  build.js
    │   └── package.json
    └── electron/   → @ccv/electron (private, version 静态)
        ├── electron/          # main.js、tab-worker.js 等
        ├── build/             # 图标/entitlements/notarize（从根 build/ 迁入）
        ├── electron-builder.yml
        └── package.json       # ★ 必须声明 app 的 9 个 runtime deps（electron-builder 要打包它们，见 §2.3）
```

**分层规则**（为你的后续细粒度拆解预留）：`apps/` = 应用型构建单元（产物被聚合或打包，永不发布）；`packages/` = 可发布包（今天仅 app）与未来从 app 再拆出的库（server / shared / content 等，演进路径见 §1.2 Phase C）。后续拆解只会在 `packages/` 内新增目录，`apps/` 与 `packages/app` 不再需要二次搬家。

### 1.2 关键取舍：为什么 server 不独立成包、shared 不独立成包

1. tarball 内 `server/lib/v2/live-feed.js` 以相对路径 `../../../src/utils/requestType.js` 引用共享缝 —— 该相对路径**在仓库里和 tarball 里必须同时成立**。
2. 若 shared/server 独立成包并以包名互引（`cc-viewer-shared/xxx`）→ 内部包不发布，用户机器上不存在 → 运行即崩；`workspace:` 重写也救不了（重写指向未发布的版本号）。
3. pack 时做「拷贝 + import 改写」codemod —— 对 40k LOC 运行时代码做文本改写，回归风险高，违背「server 原始源码发布」约定。
4. 整体 bundle server —— 破坏动态 import 与源码级排障，不可接受。

**结论**：`packages/app` 直接承载「server + cli + findcc + shims + 4 文件共享缝 + 内容资源」，pack 时只需拷入 `dist/`（纯增量、无改写）。拆包收益照样拿到：前端 61k LOC 独立成包、electron 工具链独立、app 依赖面收敛到 8 个 runtime deps（dompurify 已纠正到 web devDeps）+ 1 个 optional。

**评审验证通过的枢纽结论**：app 物理聚合方案下 pack 唯一增量动作就是拷 dist —— cli.js 的 13+ 处动态 import 全部是 `./server/*`、`./findcc.js`（包内闭合）；`cli.js:883`、`server.js:344` 自读 package.json 均相对自身位置；axios/qs 只出现在 overrides 而非代码。

**后续可选（Phase C，不在本次范围）**：若未来愿意把 `cc-viewer-shared` 发布到 npm，或接受等深目录拷贝，再抽真正的 shared 包；本方案不阻塞该演进。

### 1.3 跨包引用方式

- **web → app**：vite 编译期引用，跨包相对路径。需要改写的只有 8 处 CLIENT-SAFE import（`../server/lib/x` → 指向 `packages/app/server/lib/x` 的相对路径）—— 有白名单测试兜底，漏改即红。
- **web 内部**：93 个 utils + i18n + img + hooks 整体搬迁，相对 import 全部闭合，**零改写**。
- **electron → app**：`pathToFileURL` 绝对路径 import 机制不变，目标路径改为 `packages/app/server/...`。
- **test → app/web**：根 `test/` 相对路径 codemod（§3.3）+ 少量手工修正（§3.4）。

---

## 2. 配置与依赖分配

### 2.1 根 package.json（private 编排壳）

```jsonc
{
  "name": "cc-viewer-monorepo",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@<迁移日 latest stable>",   // 见 §0.4
  "engines": { "node": ">=22.12.0" },               // dev floor（electron 42 要求）；测试 shim 需 23.x+，CI 用 24
  "scripts": {
    "dev": "pnpm --filter @ccv/web dev",
    "build": "pnpm --filter @ccv/web build",
    "test": "…node --test …（env 与 flag 同今天）",
    "test:cli": "…CCV_TEST_CLI=1 …",
    "test:coverage": "…", "test:coverage:html": "…",
    "lint:control-bytes": "node scripts/check-no-control-bytes.js",
    "electron:dev": "pnpm --filter @ccv/electron run dev",
    "electron:build": "pnpm --filter @ccv/electron run build",
    "changeset": "changeset"
  },
  "devDependencies": {
    "c8": "^11.0.0",
    "@changesets/cli": "^2.29.0",
    // ★ 评审修正（P1）：根测试直接 bare-import 的运行时依赖必须显式声明，
    // 版本用 catalog: 引用与各包锁步（§2.2）
    "ws": "catalog:", "undici": "catalog:", "adm-zip": "catalog:",
    "node-pty": "catalog:", "dingtalk-stream": "catalog:",
    "@anthropic-ai/claude-agent-sdk": "catalog:",
    "react": "catalog:", "marked": "catalog:", "@xterm/xterm": "catalog:"
  }
}
```

### 2.2 pnpm-workspace.yaml

```yaml
packages:
  - packages/*
  - apps/*

# pnpm 10 写法；若钉 11.x 则对应 allowBuilds（codemod 自动转换）
onlyBuiltDependencies:
  - node-pty            # 硬性：native prebuild / node-gyp
  - esbuild
  - protobufjs
  - es5-ext
  - electron-winstaller
  - fsevents            # 评审补充：lockfile 里第 6 个 install 脚本
  # electron@42 无 postinstall（已实证），不进白名单

overrides:              # 从 package.json overrides 平移；写 yaml 是 v11 兼容姿势
  axios: ^1.16.1
  qs: ^6.15.2
  node-gyp: ^12.1.0     # VS2026 electron 构建承重墙，不可丢

catalog:                # 评审修正：服务于「根测试孪生依赖」的版本锁步
  ws: ^8.21.0
  undici: ^7.22.0
  adm-zip: ^0.5.17
  node-pty: ^1.1.0
  dingtalk-stream: 2.1.5
  "@anthropic-ai/claude-agent-sdk": ^0.2.91
  react: ^18.3.1
  marked: ^<现状版本>
  "@xterm/xterm": ^6.0.0
```

主仓库**不设** `shamefully-hoist`、**不设** `node-linker=hoisted`；唯一例外是 electron 构建 job 的局部 `.npmrc`（§2.5 R7 修正版）。

### 2.3 各包依赖

| 包 | dependencies | devDependencies |
|---|---|---|
| `cc-viewer` (app) | node-pty, undici, ws, adm-zip, discord.js, dingtalk-stream, @larksuiteoapi/node-sdk, @wecom/aibot-node-sdk（**必须字面量版本** —— 发布用 `npm pack`，不会重写 catalog:/workspace: 协议，见 §A2 实施记录 R2）；optionalDependencies: @anthropic-ai/claude-agent-sdk；**engines >=20.18.1**（发布契约修正） | 无 |
| `@ccv/web` | 无 runtime deps（全量打包进 dist） | react, react-dom, antd, …（前端全套，含 **dompurify** 从 dependencies 纠正至此）；vite, terser 等 |
| `@ccv/electron` | **★ 评审修正（P1）：声明 app 的全部 9 个 runtime deps + optional SDK** —— electron-builder 从 yml 所在包收集生产依赖并打进 App；不声明则桌面端打包后 server 代码 `import 'node-pty'` 全部解析失败。pnpm store 去重，无体积代价 | electron, electron-builder（**升至 ^26.14.0**，26.14 才修复 hoisted 模式嵌套依赖收集）, @electron/notarize |

### 2.4 版本与 Changesets（评审修正后的设计）

评审发现：本方案包间**没有任何 `workspace:` 依赖**（app 物理聚合），Changesets 的级联 bump（`updateInternalDependencies`）永远不会触发；给 web/electron 记「独立版本」没有消费者，只会制造与 `history.md` 重复的三条版本线。因此修正为：

```jsonc
// .changeset/config.json
{
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "privatePackages": { "version": false, "tag": false }   // web/electron 版本静态（0.0.0），不参与
}
```

- **Changesets 只管理 `cc-viewer`（app）一个包**：功能 PR 带 changeset 文件 → `pnpm changeset version` bump app + 生成 CHANGELOG → 发版。保留了用户选择的 Changesets 工作流，去掉了无消费者的版本虚构。
- `history.md` 保留在根作为人类向总 changelog（CLAUDE.md 规则不变），发版时从 changeset 摘要同步。
- **桌面端版本**：electron-builder 默认读 `apps/electron/package.json` 版本 → 会在 release.yml 用 tag 显式注入（`extraMetadata.version` 或打包前 `npm version --no-git-tag-version`），保证 dmg/exe 与 npm 版本一致。
- 若未来恢复多包发布，再把 `privatePackages.version` 打开即可，演进路径不堵死。

### 2.5 发布链路（评审实证修正，OIDC 零改动）

评审实证结论：

- `npm publish <tarball> --provenance` **正常生成 provenance**（npm 源码与实测双重确认）；且 tarball 发布**不执行任何生命周期钩子**。
- `pnpm pack` / `npm pack` 都会执行 `prepack`；`pnpm pack` 会把 tarball 落在**调用者 cwd** 并把 package.json 的 `scripts` 剥成 `{}`；`npm pack` 无此差异。
- **决策：用 `npm pack`（在 packages/app 内）而不是 `pnpm pack`** —— app 无 `workspace:` 依赖，npm pack 完全合法，产物字节与历史 npm 发布最接近。

`packages/app/package.json` 关键字段：

```jsonc
{
  "name": "cc-viewer",
  "bin": { "ccv": "cli.js" },
  "exports": { ".": "./server.js", "./interceptor.js": "./server/interceptor.js" },
  "files": [ /* 与今天完全一致 */ ],
  "engines": { "node": ">=20.18.1" },
  "scripts": {
    // ★ prepack 而非 prepublishOnly；npm publish <tarball> 不跑钩子，组装必须在 pack 前完成
    "prepack": "node scripts/assemble-dist.mjs"
  }
}
```

`assemble-dist.mjs` 的硬性要求（评审 P1）：
1. 把 `apps/web/dist` 拷入 `packages/app/dist`（幂等）；
2. **dist 缺失或旧于 `apps/web/src` 时必须 throw**（防干净 clone 打出空 dist 的静默事故）；
3. 守卫 `packages/app/package.json` 不得含任何 `workspace:` 说明符（npm 不认识该协议，会原样发布导致用户安装崩坏）。

release.yml 的 npm-publish job（A2 后形态）：

```yaml
npm-publish:
  needs: build
  runs-on: ubuntu-latest
  if: startsWith(github.ref, 'refs/tags/v')
  permissions: { id-token: write, contents: read }
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
      with: { run_install: false }
    - uses: actions/setup-node@v4
      with:
        node-version: 24
        registry-url: 'https://registry.npmjs.org'
        cache: 'pnpm'
    - run: npm install -g npm@latest        # 保留：OIDC 交换需要 npm >= 11.5.1
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter @ccv/web build        # vite → apps/web/dist
    - run: pnpm --filter cc-viewer exec npm pack    # prepack → assemble-dist；tgz 落在 packages/app
    - run: npm publish ./packages/app/cc-viewer-${GITHUB_REF_NAME#v}.tgz --provenance
```

### 2.6 electron 打包（评审 P1 集中区，A2 先做 spike）

评审发现此处不确定性最高，A2 第 0 步安排**半天 spike** 验证下列设计：

1. **staging 组装**：新增 `apps/electron/scripts/assemble-app.mjs`，把 app 负载（server/、cli.js、findcc.js、shim、src/utils 2 文件、concepts/、plugins/、ultraAgents/、web 的 dist/）+ `electron/` 拷入 `apps/electron/stage/`，并生成含 9 个 runtime deps 的 stage package.json —— 规避 electron-builder `files` 模式不允许 `..` 越界的限制（与 npm tarball 的 assemble 思路同构）。
2. **electron job 局部 `node-linker=hoisted`**（评审修正：从「逃生舱」升级为「默认」）：pnpm 官方明确 electron-builder 需要 hoisted；symlink store 下 `npmRebuild: true` 会把 node-pty 在 store 内重建成 Electron ABI，污染共享 store。做法：electron job 内 `pnpm install` 前写 job 级 `.npmrc`（lockfile 与布局无关，不影响其他 job 与缓存）。
3. `electron-builder` 升至 `^26.14.0`（hoisted 嵌套依赖收集修复）。
4. 调用方式：`pnpm --filter @ccv/electron exec electron-builder --mac/--win/--linux`（根上 `npx electron-builder` 在严格隔离下会失败）。
5. 产物路径：`apps/electron/electron-dist/*` —— release.yml 的 upload-artifact 路径同步改（今天 `if-no-files-found: ignore` 会静默丢产物，建议顺手改 `error`）。
6. `npmRebuild: true` 保留（node-pty Electron ABI 重建）；mac 公证链（build/notarize.js → apps/electron/build/）路径同步。
7. 版本注入：以 git tag 为准写入 stage package.json。

---

## 3. 执行序列

### 3.1 路线图 A：渐进式（推荐）

**阶段 A1 —— 纯 pnpm 化（不动目录）** 预估 0.5–1 天

1. 根 package.json：`packageManager` → `pnpm@<pin>`；`overrides` 平移至新建的 `pnpm-workspace.yaml`（A1 阶段只含构建脚本白名单 + `overrides`，无 `packages:` 亦可）。**实施记录**：pin = pnpm@11.22.0；因钉 11.x，白名单实际使用 v11 原生 `allowBuilds`（非 onlyBuiltDependencies）；且 `overrides` 在 package.json 中**保留了一份副本** —— electron job 在 A1 仍用 npm 安装（见第 6 步修正），npm 只认 package.json 的 overrides。
2. `pnpm import` 生成 pnpm-lock.yaml → **L0 版本保真门禁**（§4）→ 删 `node_modules/`、`package-lock.json` → `pnpm install`。**实施记录**：L0 通过（956 包，0 缺失/0 版本偏差/0 多余）。
3. 修正脚本：`build.js` 的 `npx vite build` → 直接 `node node_modules/vite/bin/vite.js build`（execFileSync 无 shell 调用）。**实施记录**：未采用 `pnpm exec` —— electron job 在 A1 仍是 npm-only 环境，`pnpm exec` 会在那里失败；直接 node 调用对 npm/pnpm 两种 node_modules 布局都免疫。
4. 本地验证四件套：`pnpm run build` / `test` / `test:cli` / `node cli.js --version` + 真实会话冒烟。
5. CI 改造（ci.yml）：

```yaml
    - uses: pnpm/action-setup@v4
      with: { run_install: false }
    - uses: actions/setup-node@v4
      with: { node-version: 24, cache: 'pnpm' }
    - run: sudo apt-get update -qq && sudo apt-get install -y -qq zsh
    - run: pnpm install --frozen-lockfile --ignore-scripts
    - run: pnpm rebuild node-pty     # ★ 保留：--ignore-scripts 会绕过 onlyBuiltDependencies 白名单
    - run: pnpm run build
    - run: pnpm run test:cli
```

6. release.yml：**实施记录（评审修正）**：npm-publish job 换为 `pnpm install --frozen-lockfile` + 保持 `npm publish --provenance`（prepublishOnly 触发构建，无显式 build 步骤）；**electron build job 在 A1 保持 npm 安装**（`npm ci` → `npm install`，因 lockfile 已删），原因是 electron-builder × pnpm 需要 hoisted linker（§2.6/R7，A2 才落地），且 pnpm 11 的 .npmrc 不再读取 node-linker 类配置。已知取舍：electron job 在 A1 期间失去 lockfile 锁定（直接依赖有 ^ 上限、传递依赖浮动），A2 转 pnpm 后恢复确定性；electron-builder `^26.8.1` 实际已解析到 26.15.3（≥26.14），A2 的版本 bump 要求自然满足。
7. 验收：CI 绿 + tarball 全局安装冒烟（含 `-logger` 注入/卸载）。
8. 提交，发布 patch 版（1.7.23）验证链路。**A1 结束即获得 pnpm 全部收益，拆包零暴露。**

**阶段 A2 —— 目录拆分** 预估 1.5–2.5 天

0. **electron spike（半天）**：按 §2.6 验证 staging + hoisted + 26.14 组合在 macOS 本机出包；失败则 electron 包暂留根布局（A2 仍可完成 web/app 拆分，electron 拆包顺延）。
1. `git mv` 建 `packages/{app,web,electron}`；app 承接 server/、cli.js、findcc.js、根 shim、`src/utils/{requestType,contentFilter}.js`（**仅 2 文件**）、concepts/、plugins/、ultraAgents/。
2. `src/` 其余全部（含 i18n.js、其余 93 个 utils）、`public/`、index.html、vite.config.js、build.js → `apps/web/`；`__APP_VERSION__` 改读 `packages/app/package.json`（版本单一来源）。
3. web 内 8 处 CLIENT-SAFE import 改写指向 `packages/app/server/lib/...`。
4. `electron/`、`build/`、electron-builder.yml → `apps/electron/`；按 §2.6 落地 staging 组装与 yml 改造；`pathToFileURL` 目标路径更新。
5. 三包 package.json 按 §2.3 落位；根壳按 §2.1 落位；`pnpm-workspace.yaml` 加 `packages: [packages/*, apps/*]` + catalog。
6. 新增 `packages/app/scripts/assemble-dist.mjs`（§2.5 三条硬性要求）+ `prepack` 钩子。
7. 测试迁移（§3.3 codemod + §3.4 手工清单）；`scripts/gen-default-voicepack.js:20` 输出路径改指 `apps/web/public/...`；`jsconfig.json` include 更新。
8. `updater.js` 增加 pnpm-global 探测（评审 P1）：realpath 含 pnpm store 路径或 `PNPM_HOME` 命中时跳过 npm 自更新并提示 `pnpm add -g cc-viewer@<v>`（仿 `brew_managed` 模式），补对应单测。
9. 产物契约 diff（L4）、全量验证（§4）、文档（CLAUDE.md 目录规则/i18n 新路径/files 规则对象变为 packages/app；README 安装段不变）。

**阶段 A3 —— Changesets 接入** 预估 0.5 天

1. `pnpm add -Dw @changesets/cli`、`pnpm changeset init`、按 §2.4 配置。
2. 先人工 `changeset version` 演练一次（假 changeset 验证输出）再提交真实配置。
3. CLAUDE.md 补约定：触及 `packages/app` 的功能 PR 必须带 changeset；pnpm-lock 冲突处理（直接 `pnpm install` 重解并提交）。

### 3.2 路线图 B：一步到位

A1+A2+A3 合并执行（~2–3 天），中间不发布：

- **优点**：工期短、无中间态、lockfile 只 churn 一次；
- **缺点**：数百文件移动 + 配置重写同屏评审困难；pnpm 化与拆分的回归互相混淆；回滚即全量；
- **硬性缓解**：至少拆成两个连续 commit（先 pnpm 化、后目录移动）；合并前完成 §4 全部验证。

**建议选 A**：本工具注入用户 CLI，事故半径大；A1 独立发布一次可把「包管理器切换」与「目录拆分」两类风险完全解耦。

### 3.3 测试 codemod 规则（评审修正版）

| 旧路径 | 新路径 |
|---|---|
| `../server/**` | `../packages/app/server/**` |
| `../cli.js` / `../findcc.js` / `../server.js` / `../interceptor.js` | `../packages/app/<同名>` |
| `../src/utils/requestType.js`、`../src/utils/contentFilter.js` | `../packages/app/src/utils/<同名>` ★ 特例 |
| `../src/**`（其余全部） | `../apps/web/src/**` |
| `../electron/**` | `../apps/electron/electron/**` |

兜底 grep：改写后 `from '\.\./(server|src|electron|cli\.js|findcc\.js)` 旧模式应零命中。

### 3.4 测试手工修正清单（codemod 覆盖不到的）

1. `test/root-shim.test.js`：`repoRoot` 计算改为指向 `packages/app`（用的是 `join(repoRoot,'interceptor.js')` 等拼接，无 import 语句）。
2. `test/client-safe-imports.test.js`：双根改造 —— 扫描根改为 `apps/web/src`，允许前缀改为 `packages/app/server/`。
3. `test/cli-boot.test.js`：`REPO_ROOT`、fake `npm root -g` fixture、spawn 的 cli.js 路径按新布局调整。
4. `test/_shims/vite-loader.mjs` / `register.mjs`：目标路径假设同步。
5. c8 覆盖率 include：`packages/app/server/**`、`packages/app/src/utils/**`、`packages/app/*.js`。
6. `_paths.js` 的 `NODE_MODULES` 在 monorepo dev 下指向 `<repo>/packages/`（不存在）—— 消费方（claude 版本检测自动开浏览器、findcc sibling 扫描）在 dev 退化为 no-op/回退 `npm root -g`，属预期行为，写进开发文档；生产 tarball 布局不变不受影响。

---

## 4. 测试与验证程序

| 层级 | 验证项 | 通过标准 |
|---|---|---|
| L0 | `pnpm import` 保真门禁 | 脚本比对 pnpm-lock 与 package-lock 的**全量** resolved 版本，差异清单人工确认（防 pnpm/pnpm#6233 静默重解析）；不达标则改用 `pnpm install --lockfile-only` 重新生成 |
| L1 | `pnpm run test` | 全绿（先存迁移前基线；按 commit-gate 原则只门禁本次回归） |
| L2 | `pnpm run test:cli` | 全绿（cli-boot、PTY 套件在内） |
| L3 | `pnpm run build` | dist 产物文件集与迁移前一致（hash 名可变，内容与数量一致；voice-packs/favicon 必须在） |
| L4 | 产物契约 | `npm pack`（先构建 web）文件清单 vs 迁移前基线：**唯一预期差异 = `src/utils/` 从 95 文件收敛为 2 文件**（运行时闭包），其余逐项一致；assemble-dist 缺 dist 时必须报错 |
| L5 | 安装冒烟 | 干净环境 `npm i -g <tarball>` → `ccv --version`、`ccv -l` 真实会话、`ccv -p`、`--fork-session`、卸载、注入/清除；**另增 `pnpm add -g` 渠道冒烟**（配合 updater 探测） |
| L6 | 旧注入标记兼容 | 手工构造含 `import '../../cc-viewer/interceptor.js';` 的 claude 安装，新包启动正常 |
| L7 | 桌面端 | electron-builder 三平台出包 + 启动 + 版本号 = git tag |
| L8 | 发布 | A1 末发 patch：provenance 绿、homebrew bump PR 正常 |

---

## 5. 风险登记册（评审修订版）

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | `node-pty` 构建被屏蔽 → PTY 静默坏死 | **P0** | onlyBuiltDependencies 白名单 + CI `--ignore-scripts` 后保留 `pnpm rebuild node-pty`（白名单对 --ignore-scripts 无效，评审实证）；test:cli PTY 套件验证 |
| R2 | 老用户注入标记解析失败 → claude 启动即崩 | **P0** | tarball 布局不变量；L4/L6；root-shim/cli-inject 测试持续锁定 |
| R3 | `_paths.js` 路径静默漂移 | **P0** | app 内 server/ 位于包根（与 tarball 同构）；迁移后立即跑 _paths 相关断言测试 |
| R4 | 测试路径改写漏改 | P1 | §3.3 codemod + §3.4 手工清单 + 兜底 grep + 全量测试 |
| R5 | `pnpm import` 解析差异/保真性 bug | P1 | L0 全量版本 diff 门禁；旧 lockfile 留 git 历史 |
| R6 | OIDC 发布链断裂 | P1 | 坚持 `npm pack` + `npm publish <tarball> --provenance`（评审实证 provenance 正常、tarball 发布不跑钩子）；§2.5 精确步骤 |
| R7 | electron-builder × pnpm 兼容 | P1 | A2 第 0 步 spike；electron job 局部 `node-linker=hoisted`；electron-builder ^26.14.0；staging 组装规避 `..` 模式 |
| R8 | 桌面端丢 runtime deps / 版本漂移 | P1 | apps/electron 声明 9 个 runtime deps；tag 注入版本 |
| R9 | pnpm 大版本升级债 | P2 | 配置全部落 pnpm-workspace.yaml（10/11 兼容）；升级 = 改一行 pin |
| R10 | Changesets 预期落空 | P2 | §2.4 修正设计（只管 app）；A3 先演练 |
| R11 | pnpm-global 用户：findcc sibling 扫描 + updater 双渠道污染 | P2 | updater 探测纳入 A2-8；findcc 的 `pnpm root -g` 候选路径记独立 issue（存量问题，不膨胀本次 scope） |
| R12 | pnpm pack 字节差异（scripts 剥空、tgz 落 cwd） | P2 | 改用 npm pack（决策已写入 §2.5） |
| R13 | Corepack 从 Node ≥25 移除 | P2 | CLAUDE.md 写明本地准备：`npm i -g pnpm@<pin>` 或 corepack；CI 用 action-setup 不受影响 |

---

## 6. 工作量与里程碑

| 里程碑 | 内容 | 预估 | 可发布 |
|---|---|---|---|
| M1 | A1 完成 + patch 发布 | 0.5–1 天 | ✅ 1.7.23 |
| M2 | A2 完成（含 electron spike、updater 探测） | 1.5–2.5 天 | 随下一版本 |
| M3 | A3（Changesets）+ 文档收尾 | 0.5 天 | 下一版本起用新流程 |
| M4（后续） | pnpm 大版本跟进、shared 真独立包、i18n 67 key 去重、findcc pnpm 全局探测 | 独立评估 | — |

---

## 7. 已拍板决策（2026-08-18 用户确认）

1. **聚合包目录名：`packages/app`**（import 路径写作 `packages/app/server/...`）。
2. **测试目录保留在根 `test/`**，不按包拆分；路径改写走 §3.3 codemod + §3.4 手工清单。
3. **接受 Changesets 修正设计**：只管 `cc-viewer`（app）一个包，web/electron 版本静态。
4. **pnpm 钉迁移日 latest 11.x**（配置双版本兼容，回退 10.x 只需一行）。
5. **electron spike 失败不阻塞 A2**：electron/ 暂留根布局，web/app 拆分照常完成，electron 拆包顺延。
6. **双层目录：`apps/{web,electron}` + `packages/{app}`**（2026-08-18 用户补充）——为后续 `packages/` 细粒度拆解预留语义分层，拆解时各单元无需二次搬家；分层规则见 §1.1。

方案已冻结，可进入二阶段实施。

---

## 附录：A2 实施记录（2026-08-19，已落地）

与方案正文的偏差及其实证依据：

1. **共享缝 = 4 文件而非 2 文件**：`requestType.js → contentFilter.js → teammateDetector.js + clearCheckpoint.js → server/lib/session-boundary.js`（均在 app 内闭合）。web 侧改写面 15 文件 + 8 处 CLIENT-SAFE，vite build 一次通过。
2. **catalog 弃用**：发布链路是 `npm pack`（不重写 `catalog:`/`workspace:` 协议），app 的 deps 必须字面量；根测试孪生依赖改用字面量（锁步价值随 app 侧无法用 catalog 而失效）。`assemble-dist.mjs` 内含 workspace:/catalog: 守卫。
3. **README.md / LICENSE.md 拷入**：npm pack 只从包目录自动附带这两个文件；A2 后它们在仓库根 → assemble-dist 负责拷入 packages/app（gitignore 忽略拷贝件）。L4 契约门禁实测：A2 tarball 与 A1 基线**唯一差异 = src/utils 收敛 91 文件**，零新增。
4. **electron 打包（spike 实证）**：`electron-builder` 必须 **≥26.14**（26.8.1 的 pnpm collector 在 pnpm 11 多包 workspace 下返回空树；实际解析 26.15.3）；`electron` devDep 必须**精确钉版**（42.0.1，hoisted 下 electron-builder 需要 fixed version 计算 electron 版本）；staging 组装（`apps/electron/scripts/assemble-app.mjs`）+ sibling 布局（stage/electron 与 stage/server 并列，rootDir 探测依赖）；**hoisted 与 isolated 两种 linker 本机均出包成功**。**UltraReview 修正：CI 最终采用默认 isolated linker** —— 原定 job 内 append `nodeLinker: hoisted` 的方案被否：(a) 该行写法是 YAML 语法错误（plain scalar 内含冒号，整个 workflow 会被 GitHub 拒收）；(b) hoisted 不落 per-package node_modules，apps/web/build.js 的 vite 路径会断，build job 的 `pnpm run build` 必败；(c) 26.15.3 在 isolated 下已实证可完整收集依赖。
5. **release.yml npm-publish job 最终形态**：`pnpm install --frozen-lockfile` → `pnpm run build`（web + assemble）→ `cd packages/app && npm pack`（prepack 重跑带守卫的 assemble）→ `npm publish "./packages/app/cc-viewer-${GITHUB_REF_NAME#v}.tgz" --provenance`（tarball 发布不跑钩子，OIDC 正常）。
6. **electron job Node 20 → 24**：pnpm 11 硬要求 Node ≥22.13。
7. **测试迁移**：codemod 两轮（import 说明符 + 路径字符串）改写 473 文件中的 426 + 47；手工修正 12 个文件（root-shim/client-safe-imports 双根/cli-import-paths appRoot/windows-npm-root 期望/findcc eval cwd/i18n 七件/modal-mask 消费集/updater pkgPath 等）；codemod 误伤 1 处 legacy 注入 fixture 字符串（`import '../../cc-viewer/interceptor.js';` 是契约不是路径）已恢复。**最终 test:cli 9482 pass / 0 fail**。
8. **updater pnpm-global 探测**：`detectPnpmGlobalInstall` 按 realpath 中 `/.pnpm/cc-viewer@<version>/` 虚拟 store 段识别（含版本形态守卫），命中返回 `pnpm_managed` 并提示 `pnpm add -g`；banner 路由同步；i18n `update.pnpmManaged` ×18 语言；新增 test/updater-pnpm.test.js 26 例。
9. **PUBLIC_DIR 探测**：`_paths.js` 的 PUBLIC_DIR 加存在性探测（app/public 不存在 → apps/web/public），生产 tarball 行为不变（本来就是死候选）。
10. **hooks 兼容**：用户 `~/.claude/settings.json` 的 4 个 cc-viewer-managed hook 路径已更新为 packages/app/server/lib/*；根 `server/lib/` 留了 4 个临时 import-shim 供本轮会话过渡（.git/info/exclude 本地忽略，不提交；会话重启后删除，见任务 A2.7）。

---

## 附录：A3 实施记录（2026-08-19，已落地）

与方案正文的偏差及其实证依据：

1. **changesets 实际接入 v3.0.0**（方案示例写 ^2.29.0）：`privatePackages: { version: false, tag: false }` 在 v3 行为不变，演练实证 web/electron 保持 0.0.0。
2. **`pnpm changeset init` 在非 TTY 下挂起**（v3 init 新增 GitHub integration 交互提问）→ 改为手写 `.changeset/config.json` + `.changeset/README.md`（init 的全部产物即这两件），配置项与 §2.4 一致。
3. **演练记录**：假 changeset（`"cc-viewer": patch`）→ `changeset status` 正确识别唯一 bump 对象 → `changeset version` 产出 1.7.23 + `packages/app/CHANGELOG.md` + 消费 changeset 文件 → 全部还原（package.json 回 1.7.22、删 CHANGELOG、`pnpm install --lockfile-only` 回同步 lockfile）。
4. **CLAUDE.md 落地两条约定**：触及 `packages/app/` 的改动必须带 changeset；`pnpm-lock.yaml` 冲突禁止手编，`pnpm install` 重解后提交。版本号只能由 `pnpm changeset version` 在发版时 bump（取代旧的「publish 时手改」约定）；A1 过渡期的 release.yml electron job 描述同步刷为 A2 终态（pnpm + isolated linker）。
