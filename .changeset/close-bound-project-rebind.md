---
"cc-viewer": patch
---

fix(multi-project): **删到只剩一个项目时「当前项目」不再停留在被删项目上** — 此前关掉绑定（当前）项目只杀 PTY、不改服务端绑定，删到 <2 个 tab 回落标签形态时标签显示的是刚被删的项目、存活项目残留在 chips。现 `POST /api/live-processes/close` 检测到关的是绑定项目且有幸存者时，把服务端绑定重绑到幸存者（`initForWorkspace` + `CCV_PROJECT_DIR` + 重启 live feed），并广播 `workspace_started(rebound:true, reboundFrom)`；同 cwd 仍有存活实例时跳过重绑以免误清其会话绑定，**同名（跨目录）存活时降级为只搬 `CCV_PROJECT_DIR` 的 dir-only 重绑且不广播**（项目名不变、各端 SSE 作用域本就正确，广播只会白白重置同名视图）。客户端只在自身视图属于被关项目域时才重置并重连（`reboundFrom` 门控，`utils/reboundScope.js`）——**正在看第三个项目的 tab 不再被强拆视图**。反转了 Header 交互边界重构（3099a750）确立的「关绑定项目不动视图」契约。Coverage: `live-processes-close.test.js`, `live-processes-refresh.test.js`, `resume-sessions-map.test.js`, `rebound-scope.test.js`.
