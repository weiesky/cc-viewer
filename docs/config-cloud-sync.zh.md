# 配置收敛与云端同步建议（cc-viewer）

> **状态：建议 / 方案 —— 尚未实现。** 本文把 cc-viewer 每一个本地配置/状态文件映射到建议的
> 数据库/云存储 schema，并定义未来的云同步模型。它是一份面向企业（genv 式）云部署的设计参考，
> 目的是让后续实现阶段对「每份配置在哪、该怎么同步」零歧义。本文不改动仓库里任何代码。

---

## 0. 一页摘要

- **现状**：cc-viewer 的所有配置/状态都是 `LOG_DIR`（默认 `~/.claude/cc-viewer`，可用
  `CCV_LOG_DIR` 覆盖）下的本地 JSON 文件。**没有**任何云客户端、账户模型或远程同步。
- **本地仍是快路径**。本地 JSON 文件仍是低延迟本地增删改读的主存储；数据库/云同步是
  **次级**兼容层，不是替代品。
- **云模型（已定）：云端为准、本地只读兜底。** 云端启用且可达时，以云端副本为准并物化到本地
  文件；云端不可达时，本地文件作为**只读兜底**——离线期间实例不接受本地编辑（不做
  「本地写 → 推送 → 失败补偿」的调和循环）。
- **SQLite**：不在范围内。本文仅记录方向（未来的单文件 `cc-viewer.db`）。**不引入
  `better-sqlite3`**——它是原生依赖，会重动构建/签名/CI。本地收敛停留在 JSON。
- **凭证上云**：两种策略都写清（§6）。**已定：凭证以密文形式上云**（S2 方向），但云端加密/同步
  **由云端团队提供加密方案**。cc-viewer 侧只做**本地 vault**（加密落盘）；当**不开启**云同步时，
  vault 纯属本地：本地对本地，任何内容都不出机器。

---

## 1. 范围与已确认决策

| # | 决策 | 取值 |
|---|---|---|
| 1 | 本文档是什么 | 给云端团队的映射 + 同步模型建议。本地配置收敛（统一 JSON store 内核、加密凭证 vault）是 cc-viewer 自身的事，本文不作规定——只界定本地 ↔ 云端的契约。 |
| 2 | 凭证范围 | 仅 cc-viewer **实有**的 3 类凭证：`profile.json` 的 `apiKey`、`preferences.json` 的 `auth.password`、IM 各平台 secret。genv 的 `official-auth`/`aima`/SSO 在此**不存在**，**不**覆盖。 |
| 3 | 云同步语义 | **云端为准、本地只读兜底**（§5）。 |
| 4 | 凭证上云 | 以**密文**上云（S2 方向）；云端加密方案由云端团队提供。cc-viewer 侧只做本地 vault；不开同步 ⇒ 纯本地。 |
| 5 | SQLite | 仅记录方向；不引入原生依赖（§8）。 |

---

## 2. 配置现状（地面真相）

**数据根**：`LOG_DIR`，在 `packages/app/findcc.js:95-130`（`resolveLogDir`）解析，默认
`join(getClaudeConfigDir(), 'cc-viewer')` = `~/.claude/cc-viewer`，环境变量覆盖 `CCV_LOG_DIR`
（`findcc.js:96`），活绑定 `export let LOG_DIR`（`findcc.js:134`），运行期可经 `setLogDir()`
改（`findcc.js:150`）。

> ⚠️ **两个根发生分叉。** 少数模块绕过 `LOG_DIR`，硬编码 `join(getClaudeConfigDir(), 'cc-viewer', …)`，
> 因而无视 `CCV_LOG_DIR`：`server/lib/updater.js:91`、`server/lib/terminal-env.js:46`、
> `server/routes/files-fs.js:87`、`server/routes/files-content.js:279`、`server/cli.js:84,1083,1098`。
> 跟随 `LOG_DIR` 的云同步 agent 会**漏掉**这些（尤其是 `update-check.json` 与 shell-rc 包装）。
> 在依赖任何同步前先把它们收敛回 `LOG_DIR`。

### 2.1 唯一正确的写路径

`preferences.json` 经**唯一**权威写者写入——`packages/app/server/lib/prefs-store.js`：

- `readPrefsRaw(file)` `:30` —— 容错读（缺失/损坏/非对象 → `{}`）。
- `mutatePrefs(mutator, file)` `:58` —— **内核**：`withFileLockAsync(preferences.lock)` → 读原文
  → 就地改（可 async）→ 原子 tmp→`renameSyncWithRetry` 写，模式 `0600` + `chmod` 复审。
- `applyPrefsPatch(target, patch, {logDir})` `:73` —— 领域合并（approvalModal/voicePack 对账）。

这是**唯一**既持锁又原子的写者。任何云同步写**必须**走 `mutatePrefs`——绕过它会破坏
`prefs-store.js:1-9` 记录的锁不变量。

### 2.2 锁与原子原语（可复用，零新造轮子）

- `server/lib/async-file-lock.js:97` `withFileLockAsync(lockPath, fn, {deadline, retryMs,
  staleThresholdMs, writePid, ensureDir})` —— 同进程 Promise 链 + 跨进程 `open('wx')` 文件锁，
  PID 存活 + mtime 陈旧判据。
- `server/lib/file-api.js:148` `renameSyncWithRetry(src, dst, {retries, delayMs})` —— 仅重试
  `EACCES/EPERM/EBUSY`（Windows 文件被读占用）。

### 2.3 Store 清单（收敛面）

直接位于 `LOG_DIR` 下的全局文件：

| 文件 | 权威模块 | 锁 | 原子 | 模式 | 领域语义 | 云类别（§4） |
|---|---|---|---|---|---|---|
| `preferences.json` | `lib/prefs-store.js` | ✅ | ✅ | 0600 | UI 偏好、`auth`、`authByProject`、`prefsByProject`、IM 平台键、`disabledPlugins` | **B（混合：明文+密钥）** |
| `profile.json` | `server/interceptor.js:94` | ❌ | ❌ | 0600 | `{profiles:[{id,name,baseURL,apiKey,…}], active}` —— **apiKey 明文**，`watchFile` 热加载 | **B（混合）** |
| `workspaces.json` | `server/workspace-registry.js:13` | ✅ | ✅ | umask | 本地工作区注册表 `{workspaces:[…]}` | **C（仅本地）** |
| `ask-store.json` | `lib/ask/ask-store.js:25` | ✅ | ✅ | umask | `SCHEMA_VERSION=1`，24h TTL 清理，首写获胜终态保护 | **D（临时，不同步）** |
| `retry-config.json` | `server/interceptor.js:109` | ❌ | ❌ | 0600 | 代理重试调优，文件覆盖 env | **A（明文同步）** |
| `.session-pin.json`（每项目） | `lib/session-pin-store.js:17` | ❌ | ✅ | umask | 每项目会话钉选；null→删除 | **C（仅本地）** |
| `active-profile.json`（每项目） | `server/interceptor.js:128` | ❌ | ✅ | 0600 | `{activeId, roles:{subagent,teammate}}` 每工作区 profile/角色选择 | **A（明文同步）** |

> 其余 store 属运行/派生状态而非用户配置：会话 wire 日志（`lib/v2/*`）、统计缓存
> （`stats-worker.js`、`proxy-stats.js`）、system-prompt 快照/实时、voice-packs、plugins 目录、
> IM-worker 目录（`IM_<id>/*`）、回收站、`update-check.json`。这些都属 **D 类**（不同步）——见 §4。

### 2.4 多写者文件（同步前必须先收敛）

- **`preferences.json` —— 4 个写者，仅 2 个安全：**
  1. `lib/prefs-store.js:58` `mutatePrefs` —— 持锁 + 原子 ✅
  2. `lib/auth.js:141-163` `writePrefs` —— 原子但**无锁**（`:147-151` 有自认 `TODO(prefs-lock)`）
  3. `lib/im/im-config.js:133-141` `writePrefs` —— **既无锁也不原子**（直接 `writeFileSync` 到目标）
  4. 路由走 `mutatePrefs` ✅
- **`profile.json` —— 4 个写者，无一持锁/原子：** `interceptor.js:235`、`routes/preferences.js:316`、
  `:371`、`:550`。
- **`~/.claude/settings.json` —— 3 个写者：** `ensure-hooks.js:340`（原子）、`routes/preferences.js:295`
  （裸写）、`cli.js:1080`（裸写）。

**含义：** 每个文件的所有写者都必须走「一个持锁+原子写路径」（cc-viewer 侧收敛），否则云同步没有
一致的可物化/可比对的磁盘状态。

---

## 3. 凭证现状

cc-viewer **没有** `official-auth`/`aima`/SSO，也**没有**任何硬编码 key 的 AES（已用 grep 验证——
无 `createCipheriv`/`scryptSync`/硬编码 key+salt）。真实凭证面：

| # | 字段 | 文件 | 编码 | 写入点 | 读取点 | 风险 |
|---|---|---|---|---|---|---|
| C1 | `profiles[].apiKey` | `profile.json` | **明文** | `routes/preferences.js:371,316,550`、`interceptor.js:235` | `interceptor.js:191,968-972`（请求注入） | **最高** |
| C2 | `auth.password` / `authByProject.*.password` | `preferences.json` | base64 | `lib/auth.js:154` | `lib/auth.js:102,118,129` | 高 |
| C3 | `dingtalk/feishu/wecom/discord` `appKey/appSecret/botToken` | `preferences.json` | base64 | `lib/im/im-config.js:137` | 各 adapter 经 `loadConfig` `:221` | 高 |

**泄漏放大器：**

- `lib/config-backup.js:10` 每次启动把 `preferences.json` + `profile.json`（明文 apiKey + base64
  secret）拷进 `~/.claude/cc-viewer-config-backups/<ts>/`，保留 10 份（`:11`）。**加密改造后这些
  历史备份仍是旧明文**，必须清理。
- `server/server.js:1139` 启动时把 LAN 密码打到 **stderr**（明文进入进程日志/容器 stdout）。
  `ACCESS_TOKEN` 同理（`:1135`）。
- 会话 wire 日志把 API key 掩成首 8 + 尾 4（`interceptor.js:850-866`）→ 每请求留存 12 个明文字符，
  无限期保留。不在 vault 范围，但云日志外发需注意。

---

## 4. 云同步类别

每个配置文件归入四类之一。这是本建议的核心。

| 类别 | 含义 | 文件 |
|---|---|---|
| **A —— 明文同步** | 非密钥用户配置。可原样推上云、拉下来。 | `retry-config.json`、每项目 `active-profile.json`、`preferences.json` 的非密钥键（UI 偏好、`disabledPlugins`、`prefsByProject`）、`profile.json` 去掉 `apiKey` 的部分 |
| **B —— 混合（明文+密钥）** | 一个文件同时含明文配置与凭证。同步前先拆：明文部分 → A 类，密钥部分 → E 类（vault）。 | `preferences.json`（auth.password + IM secret）、`profile.json`（apiKey） |
| **C —— 仅本地** | 机器/实例绑定；换台机器无意义或有害。永不同步。 | `workspaces.json`（本地路径）、每项目 `.session-pin.json` |
| **D —— 临时/派生，不同步** | 运行状态、缓存、日志、TTL store。会重建，永不同步。 | `ask-store.json`、`update-check.json`、会话 wire 日志、统计缓存、system-prompt 快照/实时、voice-packs、plugins 目录、`IM_<id>/*`、回收站 |
| **E —— 密钥（vault）** | 凭证。在考虑任何同步前先加密落盘。见 §6。 | 上述 C1/C2/C3 |

---

## 5. 云同步模型（已定语义）

> **云端为准、本地只读兜底。**

```
                    ┌──────────────┐
        拉取（启动  │              │
        + 轮询）    │   云数据库    │
   ◄────────────────│ （带鉴权 API）│
                    │              │
   ── 物化到本地 ──►│  写先落云端   │
                    └──────────────┘
```

### 5.1 云端启用且可达时

1. **拉取 → 物化。** 启动时（及轮询/刷新时）拉取 A 类配置的云端副本与 E 类密钥的*密文*（按 §6），
   通过权威写者（`preferences.json` 走 `mutatePrefs`，其余走统一内核）写入本地 JSON 文件。云端副本
   是事实源——本地文件成为云端的**投影**。
2. **写先落云端。** 本地配置编辑（经 `/api/preferences` 等）先应用到云端；成功后本地文件同步成
   一致。云端在线期间，本地文件不是主记录。

### 5.2 云端不可达（或未启用同步）时

- 本地文件作为**只读兜底**。实例继续用最近一次物化的本地副本对外服务。
- **不做本地写队列。** 离线期间实例**不**接受本地编辑，也**不**缓冲「待推送」变更日后再调和。
  这是刻意为之，避免「本地写 → 推送失败 → 标记未同步 → 补偿」循环。（理由：在云侧主导的部署里，
  离线容器被视为降级/只读，而不是日后再合并的配置分叉。）

### 5.3 未同步标记 —— 只针对「拉取」，不针对「推送」

因为写是云优先（5.1），唯一分叉是拉取失败时的**本地投影过期**。这用一个轻量*同步健康*标记
记录，而不是写积压：

- 维护一个 `sync-state.json`（D 类，仅本地），按配置键记录 `lastPulledAt` / `lastPullError`。
  拉取失败把对应键标为 `stale`，在 UI 透出（「配置可能已过期；上次同步 <ts>」）。下次拉取成功
  即清除。
- 这**不是** genv 那种本地优先的未同步写队列；它只是让只读兜底对「过期」保持诚实。

### 5.4 任何同步实现的硬约束

- 写 `preferences.json` / `profile.json` 到本地时**绝不绕过 `mutatePrefs`**（或统一内核）——否则破坏
  文件锁不变量（`prefs-store.js:1-9`）。
- 任何值离开进程前**施加不低于现有 GET 路由的脱敏**（`routes/preferences.js:127-131,160-162` 已
  剥离密钥）。泄漏密钥的同步路径就是凭证外泄通道。
- **先收敛多写者文件**（§2.4）。同步需要一致的单份磁盘状态。
- **先收敛 `CCV_LOG_DIR` 绕行点**（§2），再谈「同步 LOG_DIR 下一切」。
- 拉/推 diff 时**排除 `*.lock` 与 `*.tmp-<pid>-<hex>` 残留**。

---

## 6. 凭证与云（两种策略）

凭证（C1 apiKey、C2 password、C3 IM secret）在任何云端处理前必须先**加密落盘**。本地 vault 采用：
AES-256-GCM、每记录随机 IV、密钥派生自本地 `master.key`（`0600`，首启生成，**排除出 config-backup**）。

### 策略 S1 —— 凭证永不出本机

- 云端只同步 **A 类明文配置**。E 类凭证留在本地，加密存于 vault，**绝不**推送。
- 云端的 profile 记录带除 `apiKey` 外的一切；每台机器本地自持 apiKey（或由运维逐机注入）。
- **优点：** 爆炸半径最小；云被攻破不暴露任何 bearer 凭证；符合最小权限。**缺点：** apiKey 需逐机
  配置（密钥不漫游）。

### 策略 S2 —— 密文上云，密钥留本地（已定方向）

- E 类凭证只以 vault 密文（`base64(iv|tag|ct)`）推上云。`master.key` **绝不**出本机。
- 云端存它解不开的密文 blob；已持有对应 `master.key` 的机器拉取后解密。
- **优点：** 密钥在共享同一密钥的机器间漫游。**缺点：** 密钥分发成为难题（带外）；云被攻破暴露
  密文（弱于 S1 但非明文）；`master.key` 丢失 = 密文不可恢复。

> **已定决策：** 凭证以**密文**形式上云（S2 方向），但实际的云端加密/同步**由云端团队负责**——建议
> 云端提供加密方案。cc-viewer 侧只构建**本地 vault**（加密落盘）；当**不开启**云同步时，vault 纯属
> 本地：本地对本地，任何内容都不出机器。

---

## 7. 建议的数据库映射

本地 JSON → 关系/云存储映射。C/D 类为完整性也列出，但标「不同步」。这是**目标 schema**，由后续
阶段实现；目前尚不存在。

### 7.1 `preferences.json`（B 类 → 拆分）

非密钥键（A 类）→ 表 `user_preferences`：

| 列 | 来源（本地） | 备注 |
|---|---|---|
| `user_id`（主键） | ——（云租户） | 新增；本地今日无对应 |
| `lang` | `preferences.lang` | 服务端在 `server.js:1110-1118` 读取 |
| `ui`（jsonb） | 其余 UI 偏好 | 不透明 blob，原样 |
| `disabled_plugins`（jsonb） | `preferences.disabledPlugins` | `lib/plugin-loader.js:9,37,151` 读取 |
| `prefs_by_project`（jsonb） | `preferences.prefsByProject` | 每项目分叉（`routes/project-prefs.js`） |
| `updated_at` | —— | 同步簿记（§5.3） |

密钥键（E 类）→ **不**进 `user_preferences`；见 `credentials` 表（7.4）。

### 7.2 `profile.json`（B 类 → 拆分）

非密钥部分（A 类）→ 表 `proxy_profiles`：

| 列 | 来源 | 备注 |
|---|---|---|
| `profile_id`（主键） | `profiles[].id` | |
| `user_id`（外键） | —— | |
| `name` | `profiles[].name` | |
| `base_url` | `profiles[].baseURL` | |
| `model_map`（jsonb） | `profiles[].model…` | 非密钥映射字段 |
| `is_active` | `profile.json active` | 活动 profile 指针 |
| `updated_at` | —— | |

`apiKey`（E 类）→ `credentials` 表（7.4），按 `profile_id` 关联。

### 7.3 `retry-config.json` / `active-profile.json`（A 类）

→ 表 `runtime_config`（`user_id` 主键、`retry_config` jsonb、`active_profile` jsonb、`updated_at`）。
价值较低；若你想少几张表，可并入 `user_preferences`。

### 7.4 `credentials` 表（E 类 —— 仅策略 S2 下）

| 列 | 来源 | 备注 |
|---|---|---|
| `cred_id`（主键） | —— | |
| `user_id`（外键） | —— | |
| `kind` | `profile-apiKey` / `lan-password` / `im-secret` | |
| `ref` | `profile_id` / 平台 / `authByProject` 键 | 判别字段 |
| `ciphertext` | vault `base64(iv|tag|ct)` | **绝不明文** |
| `updated_at` | —— | |

在 **S1** 下**不建**此表；凭证只留本地 vault。在**已定的 S2 方向**下，云端存它解不开的密文，按
`user_id` + `ref` 关联。

### 7.5 C / D 类 —— 不建表

`workspaces.json`、`.session-pin.json`、`ask-store.json`、`update-check.json`、会话日志、统计缓存、
system-prompt 快照/实时、voice-packs、plugins、`IM_<id>/*` → **不建云表**；保持本地文件（C/D 类）。

---

## 8. SQLite 方向（仅记录，不实现）

后续阶段可把本地 JSON 文件收敛为单文件 `~/.claude/cc-viewer/cc-viewer.db`（SQLite），让*本地*存储
镜像云端关系 schema（profiles / prefs / runtime_config / 本地 vault）。JSON 届时降级为一次性导入源。

**为何现在不做：** `better-sqlite3` 是原生依赖，会重动构建/签名/CI 并触发 tarball 基线重建。因此本地
收敛停留在统一 **JSON** 内核——它已经做到「每文件一个持锁+原子写路径」，这正是后续 SQLite 或云端
投影的前置条件。
