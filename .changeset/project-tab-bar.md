---
"cc-viewer": patch
---

feat(web): **live 项目 ≥2 时 Header 切换为 Electron 风格等宽项目 tab 条** — ①多项目形态：Header 的「当前项目:X」标签+并行 chips 在 live 项目（主 PTY 存活）≥2 时整体替换为等宽 tab 条——每个 live 项目（含当前项目）一个 tab（状态点+项目名，点击纯视图切换、不起/不杀进程，激活 tab 内嵌主色描边高亮），当前项目 tab 保留 hover 最近 5 条会话下拉，末位 [+] 新建工作区不变；回落到 <2 个自动恢复「当前项目:X」原形态（单项目交互零变化）；判定复用 `/api/live-processes` 5s 轮询（新增纯函数 `deriveProjectTabs`），Electron tab（window.tabBridge）下不渲染。②tab × 关闭：仅激活 tab 显示 ×（Electron 同规则），Popconfirm 确认后经新增的 `POST /api/live-processes/close`（双重门禁：admin（loopback 或已鉴权远程）+ 新增共享 `lib/same-origin.js` 同源浏览器守卫，防跨站页面借用户浏览器杀进程；403/404 明确区分）杀掉该项目主 PTY——pty-manager 新增 `killPtyFor`（`attachPtyFor` 同款项目解析 + 保留 record 供重启复活；若杀的是当前终端锚点则自动重锚到另一存活 record）。前端 `closeProjectPty` 上报 forbidden/失败；关掉正在查看的项目时自动切换到存活项目（优先绑定项目），被查看项目 PTY 自然死亡/被他端关闭时经 `onLiveProjectsChange` 兜底自动 detach 回绑定项目（防 SSE 视图悬空）。关掉绑定项目只杀进程、不改服务端项目绑定（chat 保留最后状态，可经 [+] 重启）。Coverage: `live-processes-close.test.js`, `resume-sessions-map.test.js`, `new-ui-i18n.test.js`.
