# CC-Viewer SDK Integration Test Plan

## 测试环境准备

1. **确保 cc-viewer 已构建**
   ```bash
   cd /Users/limin/Documents/workspace/cc-viewer
   npm run build
   ```

2. **进入 Python 测试目录**
   ```bash
   cd /Users/limin/Documents/workspace/cc-viewer/sdk-hooks/python
   ```

## 测试用例

### Test 1: ccv proxy 命令

**目的**: 验证 `ccv proxy` 子命令正常工作

**执行**:
```bash
python tests/test_manual.py test_proxy
```

**预期结果**:
- ✓ 找到 ccv 或使用本地 cli.js
- ✓ Proxy 启动并输出端口号
- ✓ Proxy 响应 HTTP 请求
- ✓ Proxy 可以正常停止

---

### Test 2: Python SDK enable/disable

**目的**: 验证 Python SDK 的 `enable_cc_viewer()` 和 `disable_cc_viewer()` 函数

**执行**:
```bash
python tests/test_manual.py test_sdk_enable
```

**预期结果**:
- ✓ `enable_cc_viewer()` 返回 CCViewerContext
- ✓ `ANTHROPIC_BASE_URL` 被设置为 proxy URL
- ✓ Proxy 正在运行并响应请求
- ✓ `disable_cc_viewer()` 恢复环境变量

---

### Test 3: Claude Agent SDK 集成

**目的**: 验证完整的 SDK 集成流程

**前置条件**:
- 安装 claude-agent-sdk: `pip install claude-agent-sdk`
- 设置 API Key: `export ANTHROPIC_API_KEY=your-key`

**执行**:
```bash
export ANTHROPIC_API_KEY=sk-ant-xxxxx  # 你的 API Key
python tests/test_manual.py test_sdk_integration
```

**预期结果**:
- ✓ claude_agent_sdk 已安装
- ✓ CC-Viewer proxy 启动
- ✓ SDK 查询成功完成
- ✓ 生成新的 JSONL 日志文件
- ✓ 日志可以在 http://localhost:7008 查看

---

### Test 4: 手动验证 Web UI

1. 启动 cc-viewer (如果未运行):
   ```bash
   node /Users/limin/Documents/workspace/cc-viewer/cli.js
   ```

2. 在另一个终端运行 Test 3

3. 打开浏览器访问 http://localhost:7008

4. 验证:
   - [ ] 新的请求出现在列表中
   - [ ] 请求内容可以展开查看
   - [ ] 响应内容正确显示

---

## 快速测试所有基础功能

```bash
cd /Users/limin/Documents/workspace/cc-viewer/sdk-hooks/python
python tests/test_manual.py all
```

## 测试完成后

1. 检查是否有残留进程:
   ```bash
   ps aux | grep -E "ccv|node.*proxy"
   ```

2. 清理测试日志 (可选):
   ```bash
   rm -rf ~/.claude/cc-viewer/test_*
   ```

## 已知问题

- 如果 `ccv` 不在 PATH 中，测试脚本会尝试使用本地 `cli.js`
- macOS 上没有 `timeout` 命令，测试脚本使用 Python 自带的方式处理超时
