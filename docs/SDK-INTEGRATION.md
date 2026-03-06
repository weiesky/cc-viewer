# CC-Viewer SDK Integration

本文档描述如何将 cc-viewer 集成到基于 Claude Agent SDK 开发的产品中，实现 API 请求的远程监控。

## 概述

### 功能

- **请求拦截**：自动捕获所有 Claude API 请求和响应
- **日志记录**：保存为 JSONL 格式，支持查看原始内容
- **远程访问**：支持从内网其他机器访问 Web UI 查看日志
- **零配置**：用户只需一行代码启用

### 架构

```
用户应用 (Python)
    │
    ▼ enable_cc_viewer(remote=True)
    │
cc-viewer Proxy ──────► Anthropic API
    │                       │
    ▼                       ▼
日志文件 (.jsonl)      正常响应
    │
    ▼
Web UI (:7008) ◄─── 开发者浏览器访问
```

## 用户端部署

### 前置条件

- Python 3.10+
- Node.js 18+

### 安装步骤

#### 1. 安装 cc-viewer

```bash
npm install -g cc-viewer
```

#### 2. 安装 Python SDK

**从 PyPI（推荐）**：
```bash
pip install cc-viewer-sdk
```

**从 Git 安装**：
```bash
pip install git+https://github.com/limin/cc-viewer.git@main#subdirectory=sdk-hooks/python
```

#### 3. 在代码中启用

```python
from cc_viewer_sdk import enable_cc_viewer
from claude_agent_sdk import query, ClaudeAgentOptions

# 一行启用（本地访问）
enable_cc_viewer()

# 或启用远程访问
enable_cc_viewer(remote=True)

# 正常使用 SDK
async for msg in query(prompt="Hello"):
    print(msg)
```

#### 4. 防火墙配置（远程访问需要）

```bash
# Ubuntu/Debian
sudo ufw allow 7008/tcp

# CentOS/RHEL
sudo firewall-cmd --add-port=7008/tcp --permanent
sudo firewall-cmd --reload
```

### 访问日志

- **本地访问**：http://localhost:7008
- **远程访问**：http://\<服务器IP\>:7008

## API 参考

### enable_cc_viewer()

```python
def enable_cc_viewer(
    log_dir: Path | str | None = None,    # 日志目录，默认 ~/.claude/cc-viewer
    proxy_port: int | None = None,         # 代理端口，默认自动分配
    start_viewer: bool = False,            # 启动 Web 查看器（未实现）
    ccv_path: str | None = None,           # ccv 可执行文件路径
    remote: bool = False,                  # 启用远程访问（监听 0.0.0.0）
) -> CCViewerContext
```

### disable_cc_viewer()

```python
def disable_cc_viewer() -> None
```

停止代理并恢复环境变量。

### CCViewerContext

| 属性 | 类型 | 描述 |
|------|------|------|
| proxy_port | int | 代理端口 |
| proxy_url | str | 代理完整 URL |

| 方法 | 描述 |
|------|------|
| disable() | 停止代理 |

## 工作原理

### 请求流程

1. `enable_cc_viewer()` 启动本地代理服务器
2. Monkey-patch SDK 的 `SubprocessCLITransport._build_command`
3. 注入 `--settings` 参数，让 CLI 使用代理
4. CLI 发送请求到代理
5. 代理转发请求到真实 API 并记录日志
6. Web UI 读取日志文件显示

### 关键技术点

1. **CLI 不读取环境变量**：Claude Code CLI 不从 `ANTHROPIC_BASE_URL` 环境变量读取代理地址，必须通过 `--settings` 参数传递

2. **支持自定义 API 端点**：自动读取 `~/.claude/settings.json` 中的 `ANTHROPIC_BASE_URL`，支持 GLM 等第三方 API

3. **远程访问**：通过 `CC_VIEWER_HOST=0.0.0.0` 环境变量让服务监听所有网卡

## 开发说明

### 目录结构

```
sdk-hooks/python/
├── cc_viewer_sdk/
│   ├── __init__.py      # 导出
│   ├── core.py          # 主要逻辑
│   ├── proxy.py         # 代理管理
│   ├── utils.py         # 工具函数
│   └── py.typed         # PEP 561 标记
├── tests/
│   ├── test_manual.py   # 手动测试
│   ├── test_remote.py   # 远程访问测试
│   └── TEST_PLAN.md     # 测试计划
├── pyproject.toml       # 包配置
└── README.md            # 使用文档
```

### 相关文件

- `proxy.js`：Node.js 代理服务器
- `server.js`：Web UI 服务器
- `interceptor.js`：请求拦截和日志记录
- `cli.js`：`ccv` 命令行工具

### 测试

```bash
cd sdk-hooks/python

# 测试代理命令
python tests/test_manual.py test_proxy

# 测试 SDK 集成
python tests/test_manual.py test_sdk_integration

# 测试远程访问
python tests/test_remote.py
```

### 发布到 PyPI

```bash
cd sdk-hooks/python

pip install build twine
python -m build
twine upload dist/*
```

## 版本历史

### v0.1.0 (2026-03-02)

- 初始版本
- 支持 Claude Agent SDK (Python) 集成
- 支持远程访问模式
- 支持自定义 API 端点

## 相关链接

- [CC-Viewer 主项目](https://github.com/limin/cc-viewer)
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-python)
