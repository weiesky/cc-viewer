---
"cc-viewer": patch
---

fix(server+web): 计划/权限自动审批倒计时下沉到服务端——按用户设定从请求到达起算（服务端 N+1s 兜底），客户端未打开/断连/后台标签节流时也能按时自动批准；客户端取消（新增 perm-hook-auto-cancel，sdk-plan-auto-cancel 改为真实取消服务端计时器）会销毁服务端计时器并保持待手动审批；重放帧携带服务端截止时间（autoApproveAt）与取消状态，重连后显示剩余时间而不是重置满额；客户端倒计时改为 wall-clock 驱动（后台标签不再停滞）；SDK perm/ask 帧补 instanceKey（多实例重放不再丢失）；sdk-plan-answer 仅在真正解决后才广播 resolved。

行为变化：未查看的工作区的待审批请求现在也会按设定由服务端自动批准（此前只在被查看的客户端倒计时到点才批准）。安全底线：npm publish 与无人值守计划任务（scheduled-task）不走服务端自动批准，始终等待人工/5min 超时。PTY(终端 CLI) 计划的按键注入仍为客户端路径。
