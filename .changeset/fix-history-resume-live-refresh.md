---
"cc-viewer": patch
---

fix(server): **打开有预载历史的项目（SDK 模式）后发新消息不刷新对话画面** — 历史会话目录被 live-feed 重连时以 `suppressExisting` 同步种子读取，把 attach 前已落盘的新消息当历史吞掉（offset 越过、永不重读），画面冻结在预载历史上、仅刷新可见。改为按 feed 上次观察到的字节水位线抑制：种子只读到水位线、其后内容按 live 广播（既不错吞新消息，也不重放历史）。Coverage: `v2-live-feed.test.js`.
