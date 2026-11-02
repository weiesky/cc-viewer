---
"cc-viewer": patch
---

fix(web): **修复文件浏览器树在子目录下单击打开错误路径（双重前缀）** — 树行的 `childPath` 已是带前缀的根路径，`openTreeFile` 却把它塞进 `item.name` 让 `openItem` 再拼一次 `currentPath`，子目录下单击得到 `skills/skills/foo/...`。改为 `openItem` 接受可选的显式根路径，树直接传入，网格仍按 `currentPath` 推导。

fix(server): **`meta-rows.js` convSeqs 收敛合并为单遍扫描并恢复事件循环 yield** — 快照扫描已解析过的行被 coverage 段再次 `JSON.parse`，且循环无 `yieldLoop()`，在每次 `/events` 冷加载热路径上叠加 O(window 字节) 的同步解析。合并进现有扫描单遍收集。

fix(web): **`ToolFileChangeController._toolUseMap` 随 LRU 砍头同步清理** — 持久 `Map` 存每个 tool_use 的 `{name, input}`（Write 的 input 是整个文件内容），`_processedToolIds` 有 20000 条 LRU 上限而 map 无对应清理，长会话/长开 tab 内存无限累积。砍头时同步删除 map 中被砍 id 的条目。

fix(web): **审批 dismissal 守卫两处收紧** — `_setApprovalKind` 之前把任意 truthy `reason` 当合成清除（未知 reason 会静默清掉 pending 且抹掉 dismissal），改为仅 `reason === 'view-switch'`；`ChatView` 的 `_approvalViewSwitchClear` 由单布尔改为按 ptyPlan/ask 槽位记录并在 constructor 初始化，修复同一次 view-switch 同时清两个槽位时后者误判真清、重开已最小化弹窗的问题。

test(server): **补 SDK 活性两分支用例** — 审批 settle 后 watchdog 重新武装（child 沉默 → 两次探针超时判死）；lost-result backstop 武装后仍有新消息到达时释放 turn-stuck 误判（`_inboundMsgSeq` 守护）。Coverage: `sdk-manager-query.test.js`, `sdk-manager-lost-result.test.js`.
