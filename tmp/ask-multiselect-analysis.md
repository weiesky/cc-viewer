# AskUserQuestion 多选提交 — 完整分析

## 已解决

### UI 快速点击丢失
- `AskQuestionForm` 抽为独立组件，所有选择状态本地管理
- 纯 div + onClick toggle，彻底绕开 Antd Checkbox.Group 的受控组件竞态

### PTY 选择过程
- `writeToPtySequential(chunks, onComplete, opts)` 服务端队列
- 箭头 80ms、Space/→/Enter 300ms（settleMs）固定延迟
- `input-sequential` WebSocket 消息类型，服务端完成后回传 `input-sequential-done`

### 多选提交协议
- 选择完成后 `→` (右箭头) 切换到下一个 tab 或 Submit tab
- 最后一题 `→` + `Enter` 提交整个表单
- Enter 在多选选项列表上是 toggle，不是提交

### 多题表单 (tabbed form)
- Claude Code 多题 AskUserQuestion 使用 tab 导航：`[Q1] [Q2] ... [Submit]`
- `→` 在 tab 之间切换
- 中间题：选择 → `→` 切到下一题 tab
- 最后题：选择 → `→` 切到 Submit → `Enter`
- tab 切换后不会产生新的 PTY prompt，用固定 500ms 延迟代替 prompt 检测

### 多题表单 isMultiQuestion 判断 (2025-03-23 修复)
- **Bug**: `_submitViaSequentialQueue` 用 `this._askAnswerQueue.length > 0` 判断，最后一题时队列已空，导致 `isMultiQuestion=false`
- **Fix**: 在 `handleAskQuestionSubmit` 中用 `this._isMultiQuestionForm = answers.length > 1` 存储标志
- **文件**: `ChatView.jsx`

### 多选 UI 缺少 Other 选项 (2025-03-23 修复)
- **Bug**: `AskQuestionForm.jsx` 的 "Other" 回退选项只在单选 (`!isMulti`) 分支渲染，多选分支没有
- **Fix**: 在多选分支 (line 122-145) 添加了 Other 选项，选中 Other 时清空多选状态并显示文本输入框
- **文件**: `AskQuestionForm.jsx`

### 单选 Other 在多题表单中 (2025-03-23 修复)
- **Bug**: `buildOtherChunks` 没有 `isMultiQuestion` 参数，最后一题 Other 缺少额外 Enter
- **Fix**: 添加 `isMultiQuestion` 参数，`buildChunksForAnswer` 正确传递
- **验证通过**: Case 8 (2题 Other+普通), Case 10 (3题 Other+多选+单选) 均通过

### 单选 Other PTY 协议 (2025-03-23 确认)
- "Type something" 选项：**直接输入文字，不需要 Enter 激活**
- 序列：`↓↓...[text chars] Enter`
- 多题非最后题：Enter 后自动切到下一个 tab（与普通单选 Enter 行为一致）
- 多题最后题：`↓↓...[text chars] Enter Enter`（第二个 Enter 确认 Submit）

## 架构

### 文件结构
```
src/utils/ptyChunkBuilder.js    — 纯函数，构建按键序列
src/components/AskQuestionForm.jsx — 独立 UI 组件
src/components/ChatView.jsx     — 提交编排 (_submitViaSequentialQueue)
pty-manager.js                  — writeToPtySequential 服务端队列
server.js                       — input-sequential WebSocket handler
```

### 数据流
```
AskQuestionForm (local state)
  → onSubmit(answers)
  → ChatView.handleAskQuestionSubmit(answers)
  → _planSubmissionSteps(answers)  // 标注 isLast
  → _processNextAskAnswer()
  → _submitViaSequentialQueue(answer, opts)  // opts.settleMs 可覆盖
  → buildChunksForAnswer(answer, prompt, isMultiQuestion)  // 纯函数
  → WebSocket { type: 'input-sequential', chunks, settleMs }
  → server.js → writeToPtySequential(chunks, onComplete, opts)
  → PTY stdin (逐 chunk 写入，固定延迟)
  → WebSocket { type: 'input-sequential-done' }
  → _finishCurrentAskAnswer()
  → 500ms delay → _processNextAskAnswer() (下一题)
```

### ptyChunkBuilder 按键序列

单选：`↓↓...Enter`
单选（多题最后题）：`↓↓...Enter Enter`
多选（中间题）：`↓Space↓Space...→`
多选（最后题）：`↓Space↓Space...→Enter`
单选 Other（单题）：`↓↓...[text] Enter`
单选 Other（多题中间）：`↓↓...[text] Enter` (Enter 自动切 tab)
单选 Other（多题最后）：`↓↓...[text] Enter Enter`
多选 Other：见下方"待解决"

### writeToPtySequential 延迟策略
- 文本字符：80ms — 轻量操作
- Space/Enter/→/↑/↓：settleMs (默认 300ms) — inquirer 需要重绘时间
- 题间切换：500ms — tab 切换后等待渲染
- 多选 Other 使用 settleMs: 500 — 给文本字符更多处理时间

## Claude Code 多选 prompt 交互协议

```
┌─────────────────────────────────┐
│ ←  ☐ Q1  ☐ Q2  ✔ Submit  →    │  ← tab 导航栏（单题也有 tab 栏）
├─────────────────────────────────┤
│ ❯ 1. [ ] Option A              │  ← ↑↓ 导航
│   2. [ ] Option B              │  ← Space 切换 [✔]/[ ]
│   3. [ ] Option C              │
│   4. [ ] Type something        │  ← "Other" 选项（带文本输入）
│      Submit                    │  ← 非导航项，仅显示
│                                │
│   5. Chat about this           │  ← Claude Code 自动添加的选项
└─────────────────────────────────┘

操作：
- ↑↓：在选项间移动光标
- Space：切换当前选项的选中状态
- →：完成当前题，切到下一个 tab
- Enter：在选项上 = toggle（不是提交！）
        在 Submit tab = 提交整个表单
```

### "Type something" 选项的特殊行为（已验证）
- 导航到此选项后可以**直接输入文字**（不需要 Enter 激活）
- 输入文字会**自动勾选** checkbox
- 文字显示在选项行内：`> 3. [✓] 测试|`
- `→` 在文本输入中被**捕获**为光标右移，不能切到 Submit tab
- `Enter` 在文本输入中 = **toggle checkbox**，不是确认文本
- `↑`/`↓` 可以退出文本输入模式，但**会丢失最后一个字符**

### Submit tab Review 页面
- → 切到 Submit tab 后显示 Review 页面：
```
Review your answers
  ● Question text
    → answer

Ready to submit your answers?
> 1. Submit answers
  2. Cancel
```
- 需要 Enter 确认 "Submit answers"

## 多选 Other (Type something) — 状态

### 问题 1：文本截断（2026-03-27 修复）
- **根因**: inquirer 在 ↑/↓ 退出 "Type something" 文本输入时固有丢弃最后一个字符
- **修复**: 牺牲字符法 — 在文本末尾追加最后一字符的复制，↓ 丢弃牺牲字符而非真实内容
- **文件**: `src/utils/ptyChunkBuilder.js` — `buildMultiSelectOtherChunks`
- **待验证**: Case 11（单题多选 Other）、Case 12（多题混合含多选 Other）

### 问题 2：Review 页面 Enter 无响应（已确认为非 bug）
- **结论**: PTY 层面提交成功（Claude Code 已收到答案）。UI "Submitting..." 状态是正常等待期，直到 Claude 下一次 API 请求携带 tool_result 后才更新。
- **无需修复**

### 当前代码状态（2026-03-27）
`buildMultiSelectOtherChunks` 序列：
```
↓↓...(导航到 Type something)
[text chars](直接输入文字)
[sacrifice char = 最后一字符的复制]
→ (无害 no-op，提供 settleMs 延迟)
↓ (退出文本输入，丢弃牺牲字符)
→ (切到 Submit tab)
Enter (确认 Submit answers)
```

ChatView 中多选 Other 使用 `settleMs: 500`。

### 验证记录

| Case | 场景 | 结果 |
|------|------|------|
| 1 | 单选单题 | ✅ |
| 2 | 多选单题 | ✅ |
| 3 | 多题（单选+多选） | ✅ |
| 4 | 带 preview 的单选 | ✅ |
| 5 | 3题（单+多+单），普通选项 | ✅ (isMultiQuestion fix) |
| 5 | 3题全选 Other | ❌ → 修复后 ✅（单选 Other 部分） |
| 6 | 多选 + Other 选项 | ✅ UI 修复（Other 选项已显示） |
| 7 | 单题单选 Other | ✅ 文本 "测试" 正确 |
| 8 | 2题 Other+普通 | ✅ "测试" + "No" |
| 10 | 3题 Other+普通多选+普通单选 | ✅ "测试" + "X3" + "No" |
| 11 | 单题多选 Other | ⚠️ 截断 → 待验证牺牲字符修复 |
| 12 | 3题混合含多选 Other | ⚠️ 多选 Other 截断 → 待验证牺牲字符修复 |

### 关键结论
- **单选 Other**：完全正常，单题和多题都通过
- **普通多选**：完全正常
- **多选 Other**：牺牲字符修复已实装，待手动验证
- **Hook 桥接**：v1.6.55 实装（2026-03-29），可完全绕过 PTY 键盘模拟，待手动验证 updatedInput 行为

## 根本限制（部分推翻 — 见下方 SDK 协议研究）

~~Claude Code 没有非 PTY 的 prompt 响应接口。所有交互必须模拟键盘输入。~~

PTY 键盘模拟的已知限制：
- Ink（React for Terminal）全量重绘机制限制了输入速度（注：不是 inquirer）
- node-pty write 无背压（microsoft/node-pty #797）
- 固定延迟是当前最可靠的方案
- "Type something" 文本输入选项的退出行为需要特别处理

---

## SDK/stdio 协议研究（2026-03-29）

### 重大发现：Claude Code 不使用 inquirer

Claude Code 的终端 UI 基于 **Ink**（React for Terminal），不是 inquirer.js：
- 主表单组件 `Jbz` — React/Ink 渲染
- Tab 导航组件 `mh6` — 多题表单
- 文本输入组件 `x3` — `placeholder: "Type something…"`
- 键盘处理完全自定义（非 readline）
- 内部称为 "elicitation" 系统

### control_request/control_response 协议

Claude Code 在 SDK 模式（`--sdk-url`）下使用 JSON 双向协议：

**权限请求格式（Claude Code → SDK 宿主）：**
```json
{
  "type": "control_request",
  "request_id": "<uuid>",
  "request": {
    "subtype": "can_use_tool",
    "tool_name": "AskUserQuestion",
    "input": {
      "questions": [
        {
          "question": "Which library?",
          "header": "Library",
          "options": [
            { "label": "React", "description": "..." },
            { "label": "Vue", "description": "..." }
          ],
          "multiSelect": false
        }
      ]
    },
    "permission_suggestions": [],
    "tool_use_id": "<uuid>",
    "agent_id": "<string>"
  }
}
```

**权限响应格式（SDK 宿主 → Claude Code）：**
```json
{
  "behavior": "allow",
  "updatedInput": {
    "questions": [/* 原始 questions */],
    "answers": {
      "Which library?": "React"
    }
  }
}
```

**关键发现**：对于 AskUserQuestion，SDK 模式通过 `updatedInput.answers` 直接注入答案，工具接收到已填充的 `answers` 后跳过终端 UI，直接返回 `tool_result`。

### 核心函数链（cli.js）

| 函数 | 作用 | 位置 |
|------|------|------|
| `neK()` | 权限处理器选择器：sdkUrl → "stdio"，否则用默认/MCP | ~line 16528 |
| `createCanUseTool(q)` | 构建 stdio 权限处理器 | ~line 8010 |
| `WM()` | 初始启发式决策（自动 allow/deny） | implicit |
| `lpz()` | Hook 路径权限决策 | implicit |
| `sendRequest()` | 发送 control_request 到 SDK 宿主 | ~line 8010 |
| `L48()` | 响应 JSON Schema 校验 | utility |
| `P55()` | tool_result 消息构建 | ~line 38-50 |
| `A97(C)` | AskUserQuestion 答案处理器 | ~line 7851 |

### stream-json 模式的局限

`--output-format=stream-json` 是**单向输出**协议：
- 输出事件类型：system、user、assistant（text/tool_use）、result
- **不存在** `input_required` 或 `waiting_for_input` 事件
- 交互式输入（权限/AskUserQuestion）会**阻塞生成器**，不产生 JSON 事件
- 结论：stream-json **不能**用于检测或响应 AskUserQuestion

### Elicitation vs AskUserQuestion 区分

| 系统 | 用途 | Hook 可用性 |
|------|------|-------------|
| Elicitation (`elicitation_dialog`) | MCP 服务器请求用户输入 | `Elicitation`/`ElicitationResult` hook，可双向交互 |
| AskUserQuestion | Claude 工具调用询问用户 | `PreToolUse`/`PostToolUse` hook，可修改 input |
| Permission prompt | 工具执行权限审批 | `PermissionRequest` hook，SDK 模式用 stdio |

### 非交互模式标志

```javascript
K.options.isNonInteractiveSession  // 控制权限/交互行为
// --print 模式下 AskUserQuestion 可能返回空答案（不阻塞）
// SDK 模式下通过 control_request 协议获取答案
```

---

## 方案 A 实现（v1.6.55, 2026-03-29）

### 原理

利用 Claude Code 的 PreToolUse Hook 拦截 AskUserQuestion 工具调用。Hook 脚本 `ask-bridge.js` 通过 HTTP long-poll 与 cc-viewer server 通信，获取用户在 web UI 上的回答，然后通过 `hookSpecificOutput.updatedInput` 将答案注入工具输入。Claude Code 收到含 `answers` 的修改后输入，跳过终端交互 UI，直接返回 `tool_result`。

**核心优势**：完全绕过 PTY 键盘模拟，用结构化 JSON 传递答案，消除所有时序和字符截断问题。

### 配置

在 `~/.claude/settings.json` 中添加：
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          {
            "type": "command",
            "command": "node <cc-viewer安装路径>/lib/ask-bridge.js"
          }
        ]
      }
    ]
  }
}
```

### 文件结构

```
lib/ask-bridge.js               — PreToolUse hook 桥接脚本（纯 Node.js，无依赖）
server.js                       — 新增 POST /api/ask-hook + WS ask-hook-answer
src/components/ChatView.jsx     — 新增 _submitViaHookBridge 路径
pty-manager.js                  — 新增 CCVIEWER_PORT 环境变量
```

### 完整数据流

```
Claude API 返回 tool_use: AskUserQuestion { questions }
       │
       ├──→ cc-viewer 代理层捕获流式响应
       │    → ChatMessage 检测到 AskUserQuestion tool_use
       │    → AskQuestionForm 渲染（用户看到 web UI 表单）
       │
       └──→ Claude Code 收到 API 响应，开始执行工具
            → PreToolUse hook 触发（工具执行被阻塞）
            → ask-bridge.js 启动
            │
            ▼
    ┌─ ask-bridge.js ──────────────────────────────────────────┐
    │  1. 从 stdin 读取: { session_id, tool_name, tool_input } │
    │  2. 验证 tool_name === 'AskUserQuestion'                 │
    │  3. 验证 CCVIEWER_PORT 环境变量                          │
    │  4. HTTP POST → http://127.0.0.1:${port}/api/ask-hook    │
    │     body: { questions: [...] }                            │
    │  5. 等待响应（long-poll，5 分钟超时）                     │
    └──────────────────────────────────────────────────────────┘
            │ HTTP POST (blocking)
            ▼
    ┌─ cc-viewer server (server.js) ───────────────────────────┐
    │  POST /api/ask-hook 接收到请求                            │
    │  1. 解析 { questions }                                    │
    │  2. 存储 pendingAskHook = { questions, res, timer }      │
    │  3. 广播 WS: { type: 'ask-hook-pending', questions }     │
    │  4. 不立即响应 HTTP — 保持连接打开（long-poll）          │
    └──────────────────────────────────────────────────────────┘
            │ WebSocket broadcast
            ▼
    ┌─ ChatView.jsx (浏览器) ──────────────────────────────────┐
    │  _inputWs.onmessage 收到 'ask-hook-pending'              │
    │  → _askHookActive = true                                  │
    │  → _askHookQuestions = msg.questions                       │
    │                                                            │
    │  用户在 AskQuestionForm 中选择答案，点击提交               │
    │  → handleAskQuestionSubmit(answers)                        │
    │  → 检测到 _askHookActive === true                         │
    │  → _submitViaHookBridge(answers)                           │
    │     ├─ 格式转换:                                          │
    │     │  single → { "问题文本": "选项 label" }              │
    │     │  multi  → { "问题文本": "Label1, Label2" }          │
    │     │  other  → { "问题文本": "用户输入的文本" }          │
    │     └─ WS 发送: { type: 'ask-hook-answer', answers }      │
    └──────────────────────────────────────────────────────────┘
            │ WebSocket message
            ▼
    ┌─ cc-viewer server ──────────────────────────────────────┐
    │  WS handler 收到 'ask-hook-answer'                       │
    │  → 从 pendingAskHook 取出 HTTP response 对象             │
    │  → 清除 timer，清空 pendingAskHook                       │
    │  → HTTP 200 响应: { answers: { "Q?": "A" } }            │
    └──────────────────────────────────────────────────────────┘
            │ HTTP 200
            ▼
    ┌─ ask-bridge.js ──────────────────────────────────────────┐
    │  收到 HTTP 响应 { answers }                               │
    │  → 构造 hookSpecificOutput:                               │
    │    {                                                      │
    │      hookSpecificOutput: {                                │
    │        hookEventName: "PreToolUse",                       │
    │        permissionDecision: "allow",                       │
    │        updatedInput: {                                    │
    │          questions: [...原始 questions],                  │
    │          answers: { "Q?": "A" }                          │
    │        }                                                  │
    │      }                                                    │
    │    }                                                      │
    │  → stdout 输出 JSON                                      │
    │  → exit 0                                                 │
    └──────────────────────────────────────────────────────────┘
            │
            ▼
    Claude Code 收到 hook 返回
    → 工具输入被替换为 { questions, answers }
    → AskUserQuestion run() 检测到 answers 已填充
    → 跳过 Ink 终端 UI，直接返回 tool_result
    → Claude 继续执行
```

### 回退机制

每一层错误都自动回退到现有 PTY 键盘模拟路径：

```
ask-bridge.js 错误退出 (exit 1)
  → Claude Code 忽略 hook 输出
  → AskUserQuestion 正常渲染终端 UI（Ink/React）
  → PTY 输出被 cc-viewer 检测
  → AskQuestionForm 渲染
  → 用户回答
  → _submitViaSequentialQueue → PTY 键盘模拟（现有路径）
```

| 错误场景 | 行为 |
|---------|------|
| Hook 未配置 | hook 不触发，PTY 路径正常工作 |
| `CCVIEWER_PORT` 未设置 | ask-bridge exit 1，PTY 回退 |
| cc-viewer server 不可达 | ask-bridge exit 1，PTY 回退 |
| HTTP 非 200 响应 | ask-bridge exit 1，PTY 回退 |
| 用户 5 分钟未回答 | server 超时 → 408 → ask-bridge exit 1，PTY 回退 |
| ask-bridge 进程断开 | server 检测 req.close，清理 pendingAskHook，广播 timeout |
| WebSocket 断开 | ChatView 回退到 PTY 路径 |

### 答案格式转换

```
客户端格式（AskQuestionForm 输出）        Hook 格式（updatedInput.answers）
──────────────────────────────────        ─────────────────────────────────
{ questionIndex: 0,                       { "Which library?": "React" }
  type: 'single',
  optionIndex: 1 }

{ questionIndex: 0,                       { "Which features?": "Auth, Logging" }
  type: 'multi',
  selectedIndices: [0, 2] }

{ questionIndex: 0,                       { "Other feedback?": "自定义文本" }
  type: 'other',
  text: '自定义文本' }
```

### 防御性编码（Code Review 修复, 2026-03-29）

- server.js: 所有 `writeHead` 调用前检查 `res.headersSent`（防止 timeout/WS 竞态双写）
- server.js: 超大 body 返回 413 而非 `req.destroy()`（防止 `on('end')` 永不触发）
- server.js: body 限制 1MB（支持含大 preview 的 questions）
- ChatView.jsx: hook 路径设置 `_askSubmitting` 标志（UI 状态一致性）
- ask-bridge.js: `Array.isArray(data.answers)` 检查（拒绝数组类型的 answers）
- ask-bridge.js: 空 stdin 诊断信息输出（调试便利性）

### 待手动验证

**核心假设**：PreToolUse hook 的 `updatedInput` 注入 `answers` 后，AskUserQuestion 的 `run` 函数跳过 Ink 终端 UI。

此假设基于 SDK 模式 `canUseTool` 回调的行为推导（SDK 模式下 `updatedInput.answers` 是回答 AskUserQuestion 的标准方式）。需实际配置 hook 并触发 AskUserQuestion 来验证。

---

## 备选方案（未实施）

### 方案 B：Claude Agent SDK 集成

用 `@anthropic-ai/claude-code` SDK 的 `query()` API 替代 PTY 子进程，通过 `canUseTool` 回调直接处理 AskUserQuestion。最干净但需要重写整个 cc-viewer 架构（PTY 渲染、ANSI 解析、终端 UI 全部需要重做）。可作为长期方向。

### 方案 C：继续改进 PTY 模拟

基于 Ink（React for Terminal）渲染机制的新认知优化时序参数。仅解决多选 Other 截断问题，维护成本高（每次 Claude Code 更新可能需调整）。

### 方案对比矩阵

| 维度 | A. Hook 桥接 ✅ 已实施 | B. SDK 集成 | C. PTY 改进 |
|------|----------------------|-------------|-------------|
| 改动量 | 中等（~170 行新增） | 巨大（重写核心） | 小（调参数） |
| 可靠性 | 高（结构化 JSON） | 最高 | 中（时序依赖） |
| 覆盖范围 | 所有 AskUserQuestion | 所有交互 | 仅多选 Other |
| 架构侵入 | 低（PTY 保持不变） | 高（替换 PTY） | 无 |
| 维护成本 | 低 | 中 | 高 |
| 回退能力 | 自动回退到 PTY | 无回退 | N/A |

---

## PTY 模拟路径（保留作为回退）

PTY 键盘模拟路径完整保留，当 hook 未配置或任何环节出错时自动启用：

```
AskQuestionForm (local state)
  → onSubmit(answers)
  → ChatView.handleAskQuestionSubmit(answers)
  → 如果 _askHookActive → _submitViaHookBridge()   ← 新增分支
  → 否则走现有 PTY 路径:
    → _planSubmissionSteps(answers)
    → _processNextAskAnswer()
    → _submitViaSequentialQueue(answer, opts)
    → buildChunksForAnswer(answer, prompt, isMultiQuestion)
    → WebSocket { type: 'input-sequential', chunks, settleMs }
    → server.js → writeToPtySequential()
    → PTY stdin
```

### ptyChunkBuilder 按键序列（回退路径使用）

单选：`↓↓...Enter`
单选（多题最后题）：`↓↓...Enter Enter`
多选（中间题）：`↓Space↓Space...→`
多选（最后题）：`↓Space↓Space...→Enter`
单选 Other（单题）：`↓↓...[text] Enter`
单选 Other（多题中间）：`↓↓...[text] Enter`
单选 Other（多题最后）：`↓↓...[text] Enter Enter`
多选 Other：`↓↓...[text][sacrifice]→↓→Enter`
