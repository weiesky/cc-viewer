# CC Insight — Skill 评测工具

**用客观数据回答"v2 比 v1 好在哪里"。**

固定模型，只变 skill，量化对比优化前后的效果。可独立使用，也可作为 cc-viewer 插件集成。

## 评测对象

- 同一 skill 的版本迭代（v1 vs v2）
- 不同 skill 的横向对比（skill-A vs skill-B）
- 未来可扩展到 agent 评测（多轮交互场景）

## 架构

```
eval-cli.mjs （驱动层）
    ↓
claude -p （执行层，可通过 CCV_PROXY_URL 经过 cc-viewer 代理）
    ↓
LLM 自动评分（评分层，haiku）
    ↓
~/.claude/cc-viewer/eval-reports/*.json （持久化）
    ↓
report-server http://127.0.0.1:7799 （报告层）
    ├── /              运行列表
    ├── /run/<id>      对比报告
    ├── /api/runs      JSON API
    └── /api/run/<id>  JSON API
```

## 目录结构

```
context-engineering-evaluator/
├── eval-cli.mjs           # CLI 入口
├── lib/
│   ├── judge.mjs          # Claude 调用 + LLM 自动评分
│   ├── eval-runner.mjs    # 评测编排（样本 × 变体配对调度）
│   ├── report-server.mjs  # HTTP 报告服务
│   └── html-renderer.mjs  # 服务端 HTML 渲染
├── index.mjs              # cc-viewer 插件入口
├── verify.mjs             # 插件验证脚本（17 项检查）
├── eval-samples.zh.json   # 评测样本集
├── skills/                # 示例 skill 定义
│   ├── v1.md
│   └── v2.md
└── README.md
```

## 快速开始

### 1. 准备 skill 版本

在 `skills/` 目录下放置不同版本的 system prompt，文件名即版本标识：

```
skills/v1.md    # 优化前
skills/v2.md    # 优化后
```

### 2. 准备评测样本

编辑 `eval-samples.zh.json`：

```json
[
  {
    "sample_id": "s001",
    "prompt": "审查以下代码",
    "context": "function login(u, p) { db.query('SELECT * FROM users WHERE name=' + u); }",
    "rubric": "应识别 SQL 注入风险，建议使用参数化查询"
  }
]
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `sample_id` | 是 | 样本唯一标识，用于配对比较 |
| `prompt` | 是 | 用户提问 |
| `context` | 否 | 附加上下文，以代码块形式拼接到 prompt 后 |
| `rubric` | 否 | 评分标准，用于 LLM 自动评分 |

### 3. 运行评测

```bash
# 预览模式（不实际调用）
node eval-cli.mjs --dry-run

# 运行评测
node eval-cli.mjs --variants v1,v2

# 经过 cc-viewer 代理（评测请求实时出现在 cc-viewer Web UI）
CCV_PROXY_URL=http://127.0.0.1:7008 node eval-cli.mjs --variants v1,v2
```

### 4. 查看报告

评测完成后，JSON 结果自动保存到 `~/.claude/cc-viewer/eval-reports/`。

启动报告服务查看可视化对比：

```bash
node -e "import{createReportServer}from'./lib/report-server.mjs';const s=createReportServer();await s.start();await new Promise(()=>{})"
```

浏览器打开 `http://127.0.0.1:7799`：

- **运行列表**：所有评测记录，按时间倒序
- **对比报告**：变体摘要卡片（分数/token/延迟/成本）、条形图对比、逐样本明细表

## 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--variants` | `v1,v2` | 要对比的版本，逗号分隔 |
| `--samples` | `eval-samples.zh.json` | 样本文件路径 |
| `--skill-dir` | `skills` | skill 定义目录 |
| `--model` | `sonnet` | 被评测的模型（固定不变） |
| `--output-dir` | `~/.claude/cc-viewer/eval-reports/` | 报告输出目录 |
| `--no-judge` | false | 跳过 LLM 自动评分 |
| `--dry-run` | false | 只预览任务，不执行 |

## 环境变量

| 变量 | 说明 |
|------|------|
| `CCV_PROXY_URL` | 指向已运行的 cc-viewer 服务（如 `http://127.0.0.1:7008`），设置后评测请求实时出现在 cc-viewer Web UI |
| `CCV_INSIGHT_PORT` | 报告服务端口，默认 `7799` |

## 评测方法论

- **控制变量**：模型固定，只改变 skill（system prompt）
- **配对设计**：同一 sample_id 在所有 variant 下执行，消除样本难度差异
- **交替调度**：s1-v1 → s1-v2 → s2-v1 → s2-v2，降低时序偏差
- **多维度量**：质量（LLM 评分）、成本（token）、效率（延迟）、稳定性（错误率）
- **LLM 评分**：使用 haiku 作为 judge 模型，基于 rubric 对输出打分（1-5 分）

## cc-viewer 集成

可选集成，不是必须。

### 实时流量观测

设置 `CCV_PROXY_URL` 指向已运行的 cc-viewer，评测请求会通过 cc-viewer 的 `/v1/` 代理转发，实时出现在 Web UI 中：

```bash
# 终端 1：启动 cc-viewer
ccv

# 终端 2：评测流量经过 cc-viewer
CCV_PROXY_URL=http://127.0.0.1:7008 node eval-cli.mjs --variants v1,v2
```

在 cc-viewer 中可以查看每条评测请求的完整 request/response、token 用量和缓存命中情况。

技术原理见 [PROXY_DESIGN.md](PROXY_DESIGN.md)。

### 插件安装

```bash
cp -r . ~/.claude/cc-viewer/plugins/cc-insight/
```

安装后 cc-viewer 启动时会自动启动报告服务（端口 7799）。

## 已验证

- 评测脚本端到端可用（2026-03-21）
- cc-viewer 插件 17 项检查通过
- 评测流量通过 ccv 成功流入 cc-viewer 日志
- 报告服务渲染正常（运行列表 + 对比详情）

## 后续方向

- 评分区分度：更有挑战性的样本 + 更细粒度的 rubric
- 从 skill 评测扩展到 agent 评测（多轮交互）
- 与 cc-viewer 作者对齐，推动深度集成
- 样本管理结构化
- 统计显著性（置信区间、重采样统计）
