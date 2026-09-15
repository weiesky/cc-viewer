---
"cc-viewer": minor
---

feat(proxy): system 热切换渲染改用启动期变量快照，热切换首请求即生效（消除人格错配），并修复多处 system 改写缺陷。

渲染机制重构：热切换 system 文本渲染不再走 setImmediate 异步旁路（旧实现首请求沿用上一个模型 persona/cc 默认——模型 A 用人格 B，反复切换时持续错配），改为启动期按 launchInfo 发布 `${...}` 变量快照（git/os/env/memory 等与启动文本一致，每次 launch 覆盖），热切换渲染仅 time.date/model.name 实时、其余复用快照——渲染变纯字符串操作、无现场 git 子进程，切到非启动模型时同步选择 + 注入，首请求即用新模型人格。移除 `_liveGenInFlight`/`_liveGenNegative` 负缓存（其 TTL 会让新建条目 5min 内不生效，与即时生效冲突）；hook 同步段不再有 spawnSync。

修复的改写缺陷：live 门从 mainAgent===true 解耦为 _proxyRole==='main'（override 自定义 persona 主场景特性不再整体失效）+ 短路口在 live 启用时强制分类（teammate/subagent 不再被误注主 persona）+ SDK 命名队友/匿名子代理经请求头 x-claude-code-agent-id 判据拦截；override 真整段替换（保留 billing 前缀块 + CLI 官方身份行块，其余 persona 块替换，cache_control 断点继承不丢失，override 文本撞保留判据不再每请求累积）；append 保留块（billing/身份行）永不并入 + 手动 --append-system-prompt[-file] 纳入手动优先；replaceTopLevelSystem 候选扫描深度感知，allowPrepend 不再把 persona 注到工具 JSON Schema；F2 resume pin 不被覆盖；proxy 死门修复。

行为变化：system 文本随主模型热切换由「下一次 API 请求生效」改为「立即生效」；git/env 等模板变量冻结在启动值（与启动文本一致，会话中途改分支/MEMORY.md 不反映到热切换文本）；启动无注入/纯文本 sentinel/pinned-resume 且文本含 ${git.*} 时，这些变量渲染为空串。
