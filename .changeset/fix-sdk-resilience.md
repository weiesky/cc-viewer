---
"cc-viewer": patch
---

fix(server+web): SDK 韧性修复 —— 卡死回合改为按活性探活判死（不再按静默时长误杀长任务）；切回工作区恢复待审批 ask/perm；工作区 stop→重launch 后恢复 SDK 回调；长回合期间 Stop 按钮常显。
