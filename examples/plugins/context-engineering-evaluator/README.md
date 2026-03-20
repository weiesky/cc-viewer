# context-engineering-evaluator

用于 AgentTeam + cc-viewer 的版本对比插件，支持：

- 单个 skill 优化前后对比
- 多个 skill 版本对比（v1/v2/vn）
- 知识工程/上下文工程中的“知识载体”版本对比

## 安装（方案 A）

```bash
mkdir -p ~/.claude/cc-viewer/plugins
cp /Users/lizhiyao/Documents/cc-viewer/examples/plugins/context-engineering-evaluator/index.mjs ~/.claude/cc-viewer/plugins/context-engineering-evaluator.mjs
```

安装后重启 cc-viewer，或调用 `/api/plugins/reload`。

## 标签约定

在每条样本的输入中加入标签：

```text
[artifact_type:skill] [variant:v1] [sample_id:s001] ...
[artifact_type:skill] [variant:v2] [sample_id:s001] ...

[artifact_type:knowledge_pack] [variant:2026-03-19] [sample_id:k001] ...
[artifact_type:knowledge_pack] [variant:2026-03-21] [sample_id:k001] ...
```

## 输出

聚合结果写入：

`tmp/context-engineering-evaluator-report.json`

可直接查看报告：

- `http://127.0.0.1:7799/`
- `http://127.0.0.1:7799/api/report`

插件会自启动独立报告服务（默认固定端口 `127.0.0.1:7799`）：

- `/`：HTML 报告页
- `/api/report`：JSON 报告

首次采集到有效样本后，插件会在控制台输出 `report ready` 提示。

服务信息会写入：

`tmp/context-engineering-evaluator-service.json`

可通过环境变量覆盖端口：

```bash
export CCV_CONTEXT_EVAL_PORT=7799
```

分组维度：

`artifact_type + variant + teammate + sample_id`

## 方案说明

见同目录下：

`SOLUTION.zh.md`

## 单命令验活

```bash
node /Users/lizhiyao/Documents/cc-viewer/examples/plugins/context-engineering-evaluator/verify.mjs
```
