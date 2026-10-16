---
"cc-viewer": patch
---

feat(web): **会话区顶部条磨砂玻璃化** — 角色过滤条（RoleFilterBar）与任务清单条（TaskProgressHud）背景改为 `var(--bg-glass)` + `backdrop-filter: blur(20px) saturate(180%)`（对齐「新建工作区」弹窗毛玻璃）；RoleFilterBar 改为 `position: absolute` 浮在消息列表上方，消息滚动区（普通 `.container` 与 Virtuoso）向上延伸铺垫在其下方、bar 出现时按 41px 等高 `padding-top` 补偿首行可见性；role chip 加实体 `var(--bg-surface)` 底色避免毛玻璃上发虚。
