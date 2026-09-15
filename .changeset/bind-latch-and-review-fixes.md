---
"cc-viewer": patch
---

fix(proxy): system-prompt 快照绑定(Bind A)的一次性闩不再被小模型旁路请求烧掉。会话首个 main 形状请求是标题/压缩等小模型调用时,live 层已把 body.system 改写成该模型人格 → 内容匹配失败,而旧实现在此处烧掉一次性闩,导致后续真正带注入人格的请求永不重试、会话快照永不落盘,之后所有 `-c`/`-r` 恢复都走「无记录不注入」路径(注入丢失、前缀缓存全量重写)。闩改为只锁成功消费;空注入会话的 empty 兜底语义不变。另修复 review 发现的 proxy 角色分类不读 `x-claude-code-agent-id` 头(header-only 子代理被误注主 persona)、热切换渲染在启动无注入时变量快照为 null(preset 的 `${memory.dir}`/`${os.*}` 渲染成空串)、QWEN-3 族系合并后旧墓碑(QWEN-3.7-MAX)静默失效(加一次性改名映射)、deepseek-flash 简写上下文窗口档位未对齐 1M、别名表原型键查询缺陷。
