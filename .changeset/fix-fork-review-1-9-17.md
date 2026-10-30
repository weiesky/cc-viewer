---
"cc-viewer": patch
---

fix(server+web): 修复三处 fork 评审发现的上游缺陷 —— ① target 模式经 /api/file-content 保存"新文件"必 403（containment realpath 对不存在叶子返回 false，现容忍新叶子：realpath 最近存在祖先后做纯前缀比对）；② WS 闪断重连同 id 的 SDK plan 弹窗被重新弹开（_setApprovalKind null→id 过渡误清 dismiss，现仅真·新 id 替换才清，策略抽为 shouldWipeApprovalDismissal 纯函数）；③ ApprovalModal ptyPlan fallback 硬编码 countdown=null 致后台自动审批静默无取消入口，现由 payload 的 autoApproveAt 驱动显示倒计时与取消。
