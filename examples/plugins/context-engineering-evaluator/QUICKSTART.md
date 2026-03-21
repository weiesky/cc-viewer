# CC Insight POC 体验指南

用 3 分钟跑通"Skill 版本对比评测"的完整流程。

## 前置条件

- 已安装 [cc-viewer](https://github.com/anthropics/cc-viewer)（`ccv` 命令可用）
- 已安装 Claude Code CLI（`claude` 命令可用）
- Claude Code 已登录（Max plan 或 API Key 均可）

## 第一步：启动 cc-viewer

打开**终端 1**，启动 cc-viewer：

```bash
ccv
```

浏览器会自动打开 cc-viewer 界面（默认 `http://127.0.0.1:7009`），保持运行。

## 第二步：运行评测

打开**终端 2**，进入插件目录并运行评测：

```bash
cd /path/to/cc-viewer/examples/plugins/context-engineering-evaluator

node eval-cli.mjs --variants v1,v2
```

你会看到逐条执行的进度：

```
[1/6] s001/v1 ... 17492ms 3+1306tok $0.0442 score=5
[2/6] s001/v2 ... 26620ms 3+1848tok $0.0390 score=5
...
```

评测会执行 3 个样本 × 2 个版本 = 6 次调用，外加 6 次 LLM 自动评分，总共约 2-3 分钟。

### 评测过程中发生了什么？

- **v1**（`skills/v1.md`）：一句话 system prompt，"你是一个代码审查助手"
- **v2**（`skills/v2.md`）：结构化 system prompt，从安全性/健壮性/可维护性/性能四个维度审查
- 同一段代码（SQL 注入、缺少错误处理、XSS）分别用 v1 和 v2 审查
- 每次审查后，haiku 模型根据 rubric 自动打分（1-5 分）

### 同时观察 cc-viewer

切回**终端 1** 的 cc-viewer 界面，你会看到评测请求实时出现在请求列表中。点击任一请求，可以查看：

- 完整的 system prompt（即 skill 内容）
- 用户 prompt（待审查的代码）
- 模型的完整回复
- token 用量和缓存命中情况

## 第三步：查看对比报告

评测完成后，在**终端 2** 继续启动报告服务：

```bash
node -e "import{createReportServer}from'./lib/report-server.mjs';const s=createReportServer();await s.start();await new Promise(()=>{})"
```

浏览器打开 **http://127.0.0.1:7799**：

1. **运行列表页** — 展示所有评测记录
2. 点击某次运行进入**对比报告页**：
   - 变体摘要卡片：v1 vs v2 的平均分数、token、延迟、成本
   - 条形图：token 和延迟的直观对比
   - 逐样本明细：每个样本在不同版本下的得分、耗时、输出预览

## 可选操作

### 预览模式（不消耗额度）

```bash
node eval-cli.mjs --dry-run
```

查看将要执行的任务列表，不实际调用模型。

### 跳过自动评分

```bash
node eval-cli.mjs --variants v1,v2 --no-judge
```

只采集 token/延迟/成本，不做 LLM 评分，速度更快。

### 不经过 cc-viewer

```bash
CCV_EVAL_BIN=claude node eval-cli.mjs --variants v1,v2
```

直接用 `claude -p` 执行，不经过 cc-viewer 拦截。

### 使用自己的 skill 和样本

1. 在 `skills/` 目录下放你的 skill 版本（`my-v1.md`、`my-v2.md`）
2. 编辑 `eval-samples.zh.json` 添加你的测试用例
3. 运行：

```bash
node eval-cli.mjs --variants my-v1,my-v2
```

## 结果示例

```
v1（简单 prompt）     v2（结构化 prompt）
─────────────────    ─────────────────
平均延迟  14,756ms     25,460ms
平均 token   989         1,788
平均成本   $0.030       $0.038
平均评分   5.0          5.0
```

> 当前示例样本较简单，评分区分度不足。使用更有挑战性的样本和更细粒度的 rubric 可以拉开差距。

## 文件说明

| 文件 | 作用 |
|------|------|
| `eval-cli.mjs` | 评测入口，解析参数并调用 eval-runner |
| `lib/judge.mjs` | 封装 `ccv run -- claude -p` 调用和 LLM 评分 |
| `lib/eval-runner.mjs` | 评测编排：加载样本/skill、配对调度、汇总结果 |
| `lib/report-server.mjs` | HTTP 报告服务（端口 7799） |
| `lib/html-renderer.mjs` | 服务端 HTML 渲染（运行列表 + 对比报告） |
| `index.mjs` | cc-viewer 插件入口（被动采集 + 报告服务生命周期） |
| `eval-samples.zh.json` | 评测样本（3 个代码审查场景） |
| `skills/v1.md` | 示例 skill v1：一句话 prompt |
| `skills/v2.md` | 示例 skill v2：四维度结构化 prompt |
