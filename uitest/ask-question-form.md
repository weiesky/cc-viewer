# AskUserQuestion UI 测试用例

## 前置条件
- cc-viewer 服务运行中
- 浏览器打开 cc-viewer 页面
- Claude Code CLI 处于活跃会话

---

## TC-1: 单题单选

触发：Claude 调用 AskUserQuestion，1 题 3 选项，multiSelect=false

验证：
1. 对话中出现选择表单，显示 radio 样式（○/◉）
2. 点击选项 B，B 高亮
3. 点击提交
4. 终端正确选中 B 并提交
5. 对话中表单变为已回答状态（显示 ✓）

---

## TC-2: 单题多选

触发：1 题 4 选项，multiSelect=true

验证：
1. 表单显示 checkbox 样式（☐/☑）
2. 快速连点 A、C、D（跳过 B）
3. 三个都显示 ☑
4. 点击提交
5. 终端正确选中 A/C/D，→ + Enter 提交

---

## TC-3: 单题多选 — 只选最后一项

触发：1 题 4 选项，multiSelect=true

验证：
1. 只选 D
2. 提交后终端只有 D 被选中

---

## TC-4: 连续两题多选

触发：2 题，都是 multiSelect=true

验证：
1. 对话中显示两题表单
2. Q1 选 A1/C1，Q2 选 B2/C2
3. 提交
4. 终端：Q1 tab 完成 → Q2 tab 完成 → Submit
5. 返回结果 Q1=A1,C1 Q2=B2,C2

---

## TC-5: 混合题型 — 单选 + 多选

触发：Q1 单选，Q2 多选

验证：
1. Q1 选 Alpha，Q2 选 Y/Z
2. 提交
3. 终端：Q1 Enter 确认 → Q2 tab → 选择 → → + Enter
4. 返回结果正确

---

## TC-6: 连续两题单选

触发：2 题，都是 multiSelect=false

验证：
1. Q1 选 Blue，Q2 选 Cat
2. 提交
3. 终端两题依次 Enter 确认
4. 返回结果正确

---

## TC-7: 多选跳跃选择

触发：1 题 4 选项，multiSelect=true

验证：
1. 选 A 和 D（跳过 B/C）
2. 提交
3. 终端：Space(A) → ↓↓↓ → Space(D) → → Enter
4. 只有 A/D 被选中

---

## TC-8: 页面刷新后表单状态

触发：Claude 发出 AskUserQuestion 后刷新页面

验证：
1. 刷新后表单仍然显示（从日志重建）
2. 如果终端 prompt 已过期，提交无效（预期行为）
3. 不应导致 JS 错误

---

## TC-9: Other 选项

触发：1 题单选，选择 "Other" 并输入自定义文本

验证：
1. 点击 Other，出现文本输入框
2. 输入 "custom answer"
3. 提交
4. 终端：导航到 Other → Enter → 输入文本 → Enter

---

## 已知限制

- node-pty write 无背压，极端情况下按键可能丢失
- 固定延迟策略（箭头 80ms，Space/→/Enter 300ms）在高负载时可能不够
- Claude Code 未暴露非 PTY 的 prompt 响应接口
