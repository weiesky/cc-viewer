---
"cc-viewer": patch
---

fix(web): **修复发问按全局 activePtyKey 定向导致 [终端] 对、[对话] 错（切项目后立即发问进错进程）** — 切到并行项目 tab 后立即发问时，输入经 `writeToPty → _active()`（服务端全局单指针）进了上一个项目的 PTY，回复写进该项目会话，[对话] 正 viewing 新项目于是看到错项目的回复。现发问改为按锚定向：前端发问帧携带当前 viewed 项目的 `{ project, sessionId }`（`sessionId` 由 [对话] 当前会话 `_seqEpoch` 派生，附着历史会话时不带）；服务端新增 `writeToPtyFor`/`writeToPtySequentialFor` 按 `sessionId→project→active` 三级回退路由到目标 PTY（绕开全局 activePtyKey），PTY record 新增 sessionId 索引、由 v2-writer 在请求解析出会话时经 `setOnSessionResolved` 回调喂入；busy 队列注入同样透传锚。缺锚帧退回旧行为兼容。Coverage: `pty-manager-anchor.test.js`, `terminal-anchor.test.js`.
