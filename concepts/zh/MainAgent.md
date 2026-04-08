# MainAgent

## 定义

MainAgent 是 Claude Code 在非 agent team 状态下的主干请求链路。每一次用户与 Claude Code 的交互，都会产生一系列 API 请求，其中 MainAgent 请求构成了核心对话链路——它们携带完整的 system prompt、工具定义和消息历史。

## 识别方式

在 cc-viewer 中，MainAgent 通过 `req.mainAgent === true` 标识，由 `interceptor.js` 在请求捕获时自动标记。

判定条件（满足全部）：
- 请求体包含 `system` 字段（system prompt）
- 请求体包含 `tools` 数组（工具定义）
- system prompt 中包含 "Claude Code" 特征文本

## 与 SubAgent 的区别

| 特征 | MainAgent | SubAgent |
|------|-----------|----------|
| system prompt | 完整的 Claude Code 主 prompt | 精简的任务专用 prompt |
| tools 数组 | 包含全部可用工具 | 通常只包含任务所需的少量工具 |
| 消息历史 | 累积完整对话上下文 | 仅包含子任务相关消息 |
| 缓存行为 | 有 prompt caching（5 分钟 TTL） | 通常无缓存或缓存较小 |
