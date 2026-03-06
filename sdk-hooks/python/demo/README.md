# CC-Viewer SDK Demo

这个目录包含演示如何使用 CC-Viewer SDK 的示例程序。

## 前置条件

1. 安装 cc-viewer:
   ```bash
   npm install -g cc-viewer
   ```

2. 安装 Python SDK:
   ```bash
   cd sdk-hooks/python
   pip install -e .
   ```

3. 安装 Claude Agent SDK:
   ```bash
   pip install claude-agent-sdk
   ```

4. 设置 API Key:
   ```bash
   export ANTHROPIC_API_KEY=your-api-key
   ```

## 示例程序

### 1. chat_demo.py - 基本对话监控

演示如何启用 CC-Viewer 监控并与 Claude 进行对话。

```bash
python demo/chat_demo.py
```

功能:
- 启用 CC-Viewer 监控
- 与 Claude 进行多轮对话
- 所有通信记录可在 http://localhost:7008 查看

### 2. remote_demo.py - 远程监控模式

演示如何启用远程访问，让开发者可以从内网其他机器查看日志。

```bash
python demo/remote_demo.py
```

功能:
- 启用远程监控模式 (绑定到 0.0.0.0)
- 显示访问地址
- 开发者可从内网其他机器访问 http://<服务器IP>:7008

## 工作原理

```
用户应用 (Python)
    │
    │  enable_cc_viewer()
    ▼
CC-Viewer Proxy ──────► Anthropic API
    │                       │
    ▼                       ▼
日志文件 (.jsonl)      正常响应
    │
    ▼
Web UI (:7008) ◄─── 浏览器访问
```

## 常见问题

### Q: 访问 http://localhost:7008 没有反应？

确保 cc-viewer 服务已启动。如果没有自动启动，在新终端运行:
```bash
ccv
```

### Q: 远程访问无法连接？

1. 检查防火墙是否开放 7008 端口
2. 确认使用的是 `remote=True` 参数
3. 验证 IP 地址是否正确

### Q: 看不到请求日志？

1. 确认 `enable_cc_viewer()` 在 SDK 调用之前执行
2. 检查日志目录: `~/.claude/cc-viewer/`
