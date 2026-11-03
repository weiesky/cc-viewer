---
"cc-viewer": patch
---

fix(web): **`--sdk` 模式手机端终端对齐桌面 scratch 终端** — 之前手机 overlay 挂的是无主 PTY 的普通 TerminalPanel（服务端丢弃 input/resize），表现为空白 xterm + 死键栏；且 scratchOnly 分支的 phone gate 让 tab UI 完全不渲染。现 Mobile overlay 在 sdkMode 下改挂 `scratchOnly` 面板（key 强制 remount 防主 xterm 泄漏），去掉 scratchOnly 的 phone gate 并加底部虚拟键栏（直连 active tab 的 `/ws/terminal-scratch`），ScratchTerminal 补齐手机适配（60 列固定布局量容器、触摸滚动、字体与水位对齐主面板、visualViewport 软键盘重排），手机（非 iPad）tab 栏转横向（JS 设备判定，与 aria-orientation 同源）。ChatView 内嵌面板在 Mobile 树整体关闭（含 PTY 模式），消除双挂。终端切换/新增/关闭与桌面一致（同一 localStorage tab 组）。
