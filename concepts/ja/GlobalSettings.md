# CC-Viewer 全局配置参考

## 一、全局设置面板（UI）

通过左上角菜单 → "全局设置" 打开。

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| 过滤无关请求 | 开关 | 开 | 隐藏心跳、count_tokens、子代理等非主代理请求 |
| 默认展开 Body Diff JSON | 开关 | 关 | 请求详情面板中的 Body Diff 区域默认展开 |
| 日志目录设置 | 文本输入 | `~/.claude/cc-viewer` | 项目日志的读写根目录，支持 `~/` 展开。修改后回车或失焦保存，立即生效 |

## 二、显示设置面板（UI）

通过左上角菜单 → "显示设置" 打开。

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| 折叠工具结果 | 开关 | 开 | 聊天视图中折叠工具调用结果块 |
| 展开思考过程 | 开关 | 开 | 默认展开 Claude 的思考/推理过程块 |
| 完整展示所有内容 | 开关 | 关 | 显示完整的工具调用内容，不截断 |
| 自动恢复会话 | 开关 + 选项 | 关 | 遇到会话恢复提示时自动选择：`继续` 或 `新建` |

## 三、偏好设置文件

所有 UI 设置持久化到 `<日志目录>/preferences.json`，通过 `/api/preferences` 接口读写。

```json
{
  "lang": "zh",
  "filterIrrelevant": true,
  "expandDiff": false,
  "collapseToolResults": true,
  "expandThinking": true,
  "showFullToolContent": false,
  "logDir": "~/.claude/cc-viewer",
  "resumeAutoChoice": null,
  "disabledPlugins": [],
  "presetShortcuts": []
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `lang` | string | 界面语言（zh/en/zh-TW/ko/ja/de/es/fr/it/da/pl/ru/ar/no/pt-BR/th/tr/uk） |
| `filterIrrelevant` | boolean | 过滤无关请求 |
| `expandDiff` | boolean | 默认展开 Body Diff JSON |
| `collapseToolResults` | boolean | 折叠工具结果 |
| `expandThinking` | boolean | 展开思考过程 |
| `showFullToolContent` | boolean | 完整展示内容 |
| `logDir` | string | 日志目录路径 |
| `resumeAutoChoice` | null / "continue" / "new" | 自动恢复会话选择 |
| `disabledPlugins` | string[] | 已禁用的插件文件名列表 |
| `presetShortcuts` | array | Agent Team 快捷指令预设 |

## 四、环境变量

### CC-Viewer 专有

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `CCV_LOG_DIR` | `~/.claude/cc-viewer` | 日志存储根目录。特殊值：`tmp`/`temp` 使用系统临时目录 |
| `CCV_CLI_MODE` | 未设置 | `=1` 启用 CLI 模式（PTY 终端） |
| `CCV_SDK_MODE` | 未设置 | `=1` 启用 Agent SDK 模式（无终端） |
| `CCV_WORKSPACE_MODE` | 未设置 | `=1` 启用工作空间选择模式 |
| `CCV_PROJECT_DIR` | `process.cwd()` | 项目工作目录，用于文件操作和 Git 命令 |
| `CCV_PROXY_PORT` | 未设置 | 本地 MITM 代理端口 |
| `CCV_BYPASS_PERMISSIONS` | 未设置 | `=1` 跳过工具权限审批（配合 `--dangerously-skip-permissions`） |
| `CCV_DISABLE_DELTA` | 未设置 | `=1` 禁用增量日志存储，每次写入完整消息 |
| `CCV_DEBUG` | 未设置 | `=1` 启用 HTTP 代理调试日志 |
| `CCV_DEBUG_PLUGINS` | 未设置 | `=1` 启用插件加载调试日志 |

### 内部 IPC

| 变量名 | 说明 |
|--------|------|
| `CCVIEWER_PORT` | 服务端口，供 ask-bridge/perm-bridge 通信 |
| `CCV_EDITOR_PORT` | 服务端口，供 ccv-editor 文件编辑桥接 |

### 外部变量（读取）

| 变量名 | 说明 |
|--------|------|
| `ANTHROPIC_BASE_URL` | 自定义 Anthropic API 地址 |
| `SHELL` | 用户 Shell（PTY 启动和 Shell 配置检测） |
| `http_proxy` / `HTTPS_PROXY` 等 | HTTP 代理配置（通过 undici EnvHttpProxyAgent） |

## 五、CLI 命令参数

```
ccv [选项] [claude 参数...]
```

### CC-Viewer 专有选项

| 参数 | 说明 |
|------|------|
| `-logger` | 安装/修复 Claude Code hooks |
| `--uninstall` / `-uninstall` | 卸载所有 CC-Viewer 集成 |
| `--help` / `-h` / `help` | 显示帮助信息 |
| `--version` / `-v` | 显示版本号 |
| `-SDK` / `--sdk` | 使用 Agent SDK 模式 |
| `--d` | `--dangerously-skip-permissions` 简写 |
| `--ad` | `--allow-dangerously-skip-permissions` 简写 |
| `run` | 通过代理运行命令（`ccv run -- claude ...`） |

### Claude 透传参数（常用）

| 参数 | 说明 |
|------|------|
| `-c` / `--continue` | 继续上一次会话 |
| `-r` / `--resume` | 恢复指定会话 |
| `-p` / `--print` | 非交互式输出 |
| `--model` | 指定模型 |
| `--permission-mode` | 权限模式 |
| `--system-prompt` | 自定义系统提示词 |
| `--max-budget-usd` | 最大预算 |

## 六、Hook 配置

CC-Viewer 自动注册到 `~/.claude/settings.json` 的 `hooks.PreToolUse` 中：

### 1. AskUserQuestion 桥接
- **匹配器**: `"AskUserQuestion"`
- **命令**: `node <安装目录>/lib/ask-bridge.js`
- **作用**: 将 Claude 的问题转发到 Web UI，等待用户回答

### 2. 权限审批桥接
- **匹配器**: `""` (空 = 匹配所有工具)
- **命令**: `node <安装目录>/lib/perm-bridge.js`
- **作用**: 仅 `Bash`/`Edit`/`Write`/`NotebookEdit` 需要 Web UI 审批，其余自动放行

## 七、Shell 集成

CC-Viewer 在 `~/.zshrc`（或 `.bashrc`）中注入 `claude()` 函数：

```bash
# >>> CC-Viewer Auto-Inject >>>
claude() { ... }
# <<< CC-Viewer Auto-Inject <<<
```

所有 `claude` 命令自动通过 CC-Viewer 代理，实现日志捕获和 Web UI 功能。

卸载：`ccv --uninstall` 或手动删除标记之间的内容。

## 八、代理配置（Proxy Profile）

存储在 `<日志目录>/profile.json`，通过 UI 的"代理切换"面板管理。

```json
{
  "active": "max",
  "profiles": [
    { "id": "max", "name": "Default" },
    { "id": "my-proxy", "name": "自定义", "baseURL": "https://...", "apiKey": "sk-..." }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `active` | 当前激活的配置 ID（`"max"` = 直连，无代理） |
| `id` | 唯一标识 |
| `name` | 显示名称 |
| `baseURL` | 代理 API 地址（替换请求 origin） |
| `apiKey` | 代理 API 密钥（替换认证头） |
| `models` | 可用模型列表 |
| `activeModel` | 当前选中的模型 |

## 九、插件系统

插件目录：`<日志目录>/plugins/`

### 支持的 Hook 类型

| Hook | 类型 | 说明 |
|------|------|------|
| `httpsOptions` | 瀑布 | 提供 HTTPS 证书（返回 `{ cert, key }` 或 `{ pfx }`） |
| `localUrl` | 瀑布 | 修改本地访问 URL |
| `serverStarted` | 并行 | 服务器启动通知 |
| `serverStopping` | 并行 | 服务器停止通知 |
| `onNewEntry` | 并行 | 新日志条目写入通知 |

插件启用/禁用通过 `preferences.json` 的 `disabledPlugins` 数组管理。

## 十、目录结构

```
~/.claude/cc-viewer/               # 日志根目录
├── preferences.json               # 用户偏好设置
├── workspaces.json                # 工作空间注册表
├── profile.json                   # 代理配置
├── plugins/                       # 插件目录
│   └── my-plugin.js
├── <项目名>/                       # 每个项目的日志目录
│   ├── <项目名>_20260404_123456.jsonl  # JSONL 日志文件
│   ├── <项目名>.json              # 统计数据（后台生成）
│   └── images/                    # 上传图片的持久副本
└── ...

/tmp/cc-viewer-uploads/            # 临时上传文件目录
```

## 十一、服务器配置

| 配置 | 值 | 说明 |
|------|-----|------|
| 端口范围 | 7008-7099 | 自动扫描可用端口 |
| 绑定地址 | 0.0.0.0 | 所有网络接口 |
| 访问令牌 | 随机 16 字节 hex | 局域网访问需要 `?token=xxx`，本机免认证 |
| HTTPS | 仅通过插件 | 需要插件提供 `httpsOptions` hook |
| CORS | `*` | 允许所有来源 |
| 上传限制 | 50MB | 单文件最大上传大小 |

## 十二、URL 参数

| 参数 | 说明 |
|------|------|
| `?token=xxx` | 局域网访问认证令牌 |
| `?logfile=path` | 打开指定历史日志文件（只读模式） |

## 十三、localStorage 配置

| 键 | 说明 |
|-----|------|
| `ccv_cacheExpireAt` | 缓存倒计时到期时间 |
| `ccv_cacheType` | 缓存类型标签 |
| `ccv_sseSlim` | 启用 SSE 增量裁剪（桌面端性能优化） |
| `ccv_calibrationModel` | KV-Cache 上下文窗口校准模型 |
| `ccv_fileExplorerOpen` | 文件浏览器面板开关 |
| `cc-viewer-terminal-width` | 终端面板宽度（像素） |
