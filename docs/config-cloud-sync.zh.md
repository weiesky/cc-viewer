# 配置云端同步 —— 云端接口契约（cc-viewer）

> 本文定义 cc-viewer 与云端的契约：哪些键上云、云端要提供哪些接口（名称/参数/存储/返回）、
> 密钥如何独立处理。本地实现细节不在本文范围。

---

## 1. 同步范围

云端**只**接受以下配置：

| 云端对象 | 来源（本地） | 包含的键 | 说明 |
|---|---|---|---|
| `user_preferences` | `preferences.json`、每项目 `active-profile.json` | `lang`、`ui`、`disabledPlugins`、`prefsByProject`、`activeProfile` | 非密钥 UI/功能偏好 + 每项目 profile/角色指派 |
| `proxy_profiles` | `profile.json` | `profiles[].id/name/baseURL/model…`、`active` | **不含 `apiKey`**（密钥走 §4） |
| `credentials` | 本地 vault 密文 | `kind`、`ref`、`ciphertext` | **仅存密文**，见 §4 |

> **不**上云（机器/实例绑定、运行态或调优项）：`retry-config.json`（重试调优，随实例走）、
> `workspaces.json`、`.session-pin.json`、`ask-store.json`、`update-check.json`、会话 wire 日志、
> 统计缓存、system-prompt 快照/实时、voice-packs、plugins、`IM_<id>/*`、回收站。

**密钥拆分原则**：`preferences.json` 与 `profile.json` 是混合文件。上云前先拆——明文部分进
`user_preferences`/`proxy_profiles`；密钥（`profiles[].apiKey`、`auth.password`、IM
`appSecret/botToken`）进 `credentials` 密文通道（§4）。云端接口**不得**在明文对象里出现密钥字段。

---

## 2. 同步语义（云端为准）

- **云端为准**：云端启用且可达时，本地文件是云端的投影。写先落云端，成功后物化到本地；拉取在启动
  时（及轮询）进行。
- **本地只读兜底**：云端不可达时，本地副本只读，**不**接受本地编辑、**不**缓冲离线写日后再推。
- **过期标记**：拉取失败只产生「本地投影过期」，用 `sync-state.json`（本地）记每键 `lastPulledAt` /
  `lastPullError`，UI 提示「上次同步 <ts>」，下次成功即清除。无写队列。

---

## 3. 云端接口（REST，均以 `userId` 鉴权）

所有接口需鉴权并解析出 `user_id`。请求/返回均为 JSON。

### 3.1 `user_preferences`（明文偏好）

**`GET /config/preferences?userId=<id>`**
- **返回** `200`：`{ lang, ui, disabledPlugins, prefsByProject, activeProfile, updatedAt }`
- 字段（存什么 → 驱动哪个功能；云端键 ↔ 本地键）：
  - `lang` string —— 界面语言；服务端下发文案的语言。↔ 本地 `preferences.lang`
  - `ui` object —— 界面外观/布局/开关集合；前端 UI 渲染。云端不解析内部结构。↔ 本地 `preferences` 的 UI 键（其中 `theme` ↔ 本地 `themeColor`，见 §3.4）
  - `disabledPlugins` string[] —— 被禁用插件的 ID；插件加载器据此跳过加载。↔ 本地 `preferences.disabledPlugins`
  - `prefsByProject` object —— 每项目偏好分叉（键=项目目录，值=该项目覆盖全局的那部分）；项目级个性化设置。↔ 本地 `preferences.prefsByProject`
  - `activeProfile` object —— 每项目的 profile 与角色指派（键=项目，值=`{ activeId, roles:{subagent, teammate} }`）；子代理/队友请求分别走哪个 profile。↔ 本地每项目 `active-profile.json` 的 `{ activeId, roles }`
  - `updatedAt` ISO 时间戳 —— 最近云端写入时间；同步「过期」判断。本地无对应（云端簿记）。

**`PUT /config/preferences`**
- **参数**（body）：`{ userId, lang?, ui?, disabledPlugins?, prefsByProject?, activeProfile? }`（部分更新，缺省键不动）
- **返回** `200`：`{ updatedAt }`

示例：

```http
GET /config/preferences?userId=u123
```
```json
{
  "lang": "zh",
  "ui": { "theme": "dark", "sidebarCollapsed": false },
  "disabledPlugins": ["voice-pack", "telemetry"],
  "prefsByProject": {
    "/Users/x/proj-a": { "lang": "en" }
  },
  "activeProfile": {
    "/Users/x/proj-a": { "activeId": "p-glm", "roles": { "subagent": "p-openai", "teammate": "follow" } }
  },
  "updatedAt": "2026-09-21T08:00:00Z"
}
```

```http
PUT /config/preferences
```
```json
// 请求
{ "userId": "u123", "lang": "en", "disabledPlugins": ["telemetry"] }

// 返回 200
{ "updatedAt": "2026-09-21T09:12:30Z" }
```

### 3.2 `proxy_profiles`（明文 profile，无 apiKey）

**`GET /config/profiles?userId=<id>`**
- **返回** `200`：`{ profiles: [{ profileId, name, baseUrl, modelMap }], activeProfileId, updatedAt }`
- 字段（存什么 → 驱动哪个功能；云端键 ↔ 本地键）：
  - `profiles[].profileId` string —— profile 唯一标识；请求路由与密钥关联的键。↔ 本地 `profiles[].id`
  - `profiles[].name` string —— 展示名；UI profile 列表显示。↔ 本地 `profiles[].name`
  - `profiles[].baseUrl` string —— 该 profile 的代理目标 URL；出站请求被改写到这个地址。↔ 本地 `profiles[].baseURL`
  - `profiles[].modelMap` object —— 模型路由（`ANTHROPIC_MODEL`/`ANTHROPIC_DEFAULT_OPUS_MODEL`/`SONNET`/`HAIKU`/`effort` 等）；决定各档模型实际改写成什么。↔ 本地这些键**平铺在 profile 对象顶层**（`profiles[].ANTHROPIC_MODEL` 等），云端收进 `modelMap` 子对象，物化时展开。**不含密钥**。
  - `activeProfileId` string —— 当前生效 profile；全局请求默认走它。↔ 本地 `profile.json` 的 `active`
  - `updatedAt` ISO 时间戳。

**`PUT /config/profiles`**
- **参数**（body）：`{ userId, profiles: [{ profileId, name, baseUrl, modelMap }], activeProfileId }`
  —— 整体替换该用户的 profile 集合并重置活动指针。
- **返回** `200`：`{ updatedAt }`
- **约束**：任何 profile 对象**不得含 `apiKey`**；密钥走 §4 的 `credentials` 通道。

示例：

```http
GET /config/profiles?userId=u123
```
```json
{
  "profiles": [
    {
      "profileId": "p-openai",
      "name": "OpenAI 直连",
      "baseUrl": "https://api.openai.com",
      "modelMap": { "ANTHROPIC_MODEL": "gpt-5", "effort": "high" }
    },
    {
      "profileId": "p-glm",
      "name": "GLM",
      "baseUrl": "https://open.bigmodel.cn/api/anthropic",
      "modelMap": { "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-4.6", "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-4.6" }
    }
  ],
  "activeProfileId": "p-openai",
  "updatedAt": "2026-09-21T08:00:00Z"
}
```

```http
PUT /config/profiles
```
```json
// 请求
{
  "userId": "u123",
  "profiles": [
    { "profileId": "p-openai", "name": "OpenAI 直连", "baseUrl": "https://api.openai.com", "modelMap": { "ANTHROPIC_MODEL": "gpt-5", "effort": "high" } }
  ],
  "activeProfileId": "p-openai"
}

// 返回 200
{ "updatedAt": "2026-09-21T09:15:00Z" }
```

### 3.3 `credentials`（密文）

接口与存储见 §4。

### 3.4 数据库存储结构

> **jsonb**：PostgreSQL 的二进制 JSON 列类型，可直接存储/索引 JSON 文档。适合不透明、结构多变的
> 配置 blob（`ui`、`prefsByProject`、`modelMap` 等）——原样存取，无需逐列建模。

**`user_preferences`**
| 列 | 类型 | 功能说明 |
|---|---|---|
| `user_id` | text 主键 | 云租户；一行=一个用户 |
| `lang` | text | 界面语言 → 服务端下发文案语言。↔ `preferences.lang` |
| `ui` | jsonb | UI 偏好集合 → 前端渲染。子键如 `theme`（light/dark 主题；本地 `preferences.json` 键为 `themeColor`，物化时映射）、`modalEnabled`（审批弹窗开关）、`soundEnabled`（提示音开关）、`notifyOnlyWhenHidden`（仅窗口隐藏时通知）、`voicePack`（语音包，见下）等；云端不解析内部结构 |
| `disabled_plugins` | jsonb | 禁用插件 ID 数组 `["voice-pack", …]` → 插件加载器按 ID 跳过。↔ `preferences.disabledPlugins` |
| `prefs_by_project` | jsonb | 每项目偏好分叉 → 项目级个性化。结构 `{ "<项目目录>": { …被该项目覆盖的 ui/approvalModal 子集… } }`；`auth`/`authByProject`/`prefsByProject`/`logDir`/`claudeConfigDir` 被剥离不进分叉。↔ `preferences.prefsByProject` |
| `active_profile` | jsonb | 每项目 profile/角色指派 → 子代理/队友路由。结构 `{ "<项目>": { "activeId": "<profileId>", "roles": { "subagent": "<profileId>\|follow\|max", "teammate": … } } }`；`follow`=跟随 activeId、`max`=内置默认不改写。↔ 每项目 `active-profile.json` 的 `{ activeId, roles }` |
| `updated_at` | timestamptz | 最近写入时间 → 过期判断 |

> `ui` 内嵌的 `voicePack` 子树：`{ enabled, volume, events }`；`events` 为白名单事件映射，键限
> `planApproval`/`askQuestion`/`turnEnd`，值 = 音频包 ID（`default`/`sanguo`/自定义）或 `null`（关闭）。
> 驱动审批/提问/回合结束的提示音播放。

**`proxy_profiles`**
| 列 | 类型 | 功能说明 |
|---|---|---|
| `profile_id` | text 主键 | profile 标识 → 路由与密钥关联键。↔ 本地 `profiles[].id` |
| `user_id` | text 外键 | 归属用户 |
| `name` | text | 展示名 → UI 列表。↔ 本地 `profiles[].name` |
| `base_url` | text | 代理目标 → 出站请求改写地址。↔ 本地 `profiles[].baseURL` |
| `model_map` | jsonb | 模型路由 → 各档模型实际改写。子键：`ANTHROPIC_MODEL`（统一模型）、`ANTHROPIC_DEFAULT_OPUS_MODEL`/`SONNET`/`HAIKU`（按档覆盖）、`effort`（推理强度）等；拦截器据此替换请求体里的模型字段。↔ 本地平铺在 profile 顶层 |
| `is_active` | bool | 是否生效 profile → 默认请求走它。↔ 本地 `profile.json` 的 `active`（值=profile_id） |
| `updated_at` | timestamptz | 最近写入时间 |

**`credentials`** → 见 §4。

---

## 4. 密钥（独立章节）

密钥与明文配置**完全分开**。已定方向 **S2：密文上云，密钥留本地**。

- 密钥在本机以 AES-256-GCM 加密落盘（本地 vault，主密钥 `master.key`）。
- **只有密文** `base64(iv|tag|ct)` 上云；`master.key` **绝不出本机**。
- 云端存它**解不开**的密文 blob，按 `user_id` + `ref` 关联；已持有对应 `master.key` 的机器拉取后解密。
- 不开启云同步时，vault 纯属本地，任何内容不出机器。

**密钥种类**（`kind`）：
| kind | 来源 | 驱动功能 | `ref` 判别字段 |
|---|---|---|---|
| `profile-apiKey` | `profiles[].apiKey` | 代理出站请求的 bearer key → 请求鉴权注入 | `profile_id` |
| `lan-password` | `auth.password` / `authByProject.*.password` | 远程/LAN 打开 cc-viewer 的登录密码 → 访问鉴权 | `global`（全局）/ `proj:<项目目录>`（项目覆盖） |
| `im-secret` | 各平台密钥字段：dingtalk/feishu 的 `appSecret`、wecom 的 `secret`、discord 的 `botToken` | IM 机器人出站调平台 API → 消息推送鉴权 | `<平台>.<字段>`（如 `wecom.secret`、`discord.botToken`） |

**云端接口**
- **`GET /config/credentials?userId=<id>`** → `200 { creds: [{ credId, kind, ref, ciphertext, updatedAt }] }`
- **`PUT /config/credentials`** body `{ userId, creds: [{ kind, ref, ciphertext }] }` → `200 { updatedAt }`
  —— 按 `kind`+`ref` upsert；`ciphertext` 仅密文。

示例：

```http
GET /config/credentials?userId=u123
```
```json
{
  "creds": [
    { "credId": "c1", "kind": "profile-apiKey", "ref": "p-openai", "ciphertext": "Aa9x…(iv|tag|ct 的 base64)", "updatedAt": "2026-09-21T08:00:00Z" },
    { "credId": "c2", "kind": "lan-password", "ref": "global", "ciphertext": "Qp2m…", "updatedAt": "2026-09-21T08:00:00Z" },
    { "credId": "c3", "kind": "im-secret", "ref": "feishu.appSecret", "ciphertext": "Zz81…", "updatedAt": "2026-09-21T08:00:00Z" }
  ]
}
```

```http
PUT /config/credentials
```
```json
// 请求
{ "userId": "u123", "creds": [ { "kind": "profile-apiKey", "ref": "p-glm", "ciphertext": "Mk4t…" } ] }

// 返回 200
{ "updatedAt": "2026-09-21T09:25:00Z" }
```

**`credentials` 表**
| 列 | 类型 | 功能说明 |
|---|---|---|
| `cred_id` | text 主键 | 凭证记录唯一标识 |
| `user_id` | text 外键 | 归属用户 |
| `kind` | text | 凭证种类（上表三种） |
| `ref` | text | 判别字段：指向该密钥服务的对象（profile/项目/平台） |
| `ciphertext` | text | 密文 `base64(iv|tag|ct)`，**绝不明文** |
| `updated_at` | timestamptz | 最近写入时间 |
