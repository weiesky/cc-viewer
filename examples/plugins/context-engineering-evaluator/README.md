# CC Insight — 知识载体版本对比评测

知识工程/上下文工程中**知识载体的版本对比评测**工具。可独立使用，也可作为 cc-viewer 插件集成。

## 背景

在企业知识工程实践中，团队持续迭代 skill、知识包等知识载体。当被问到"v2 比 v1 好在哪里"时，需要用客观数据回答。本工具提供可复现的评测能力，固定模型，只变知识载体，量化对比效果。

## 架构

```
eval-cli.mjs （驱动层）
    ↓
ccv run -- claude -p （执行层，流量经过 cc-viewer）
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

评测流量默认通过 `ccv run -- claude -p` 执行，自动经过 cc-viewer 拦截器记录到日志。cc-viewer Web UI 中可查看每条评测请求的完整 request/response。

## 目录结构

```
context-engineering-evaluator/
├── eval-cli.mjs           # CLI 入口
├── lib/
│   ├── judge.mjs          # Claude 调用 + LLM 自动评分
│   ├── eval-runner.mjs    # 评测编排（样本 × 变体配对调度）
│   ├── report-server.mjs  # HTTP 报告服务
│   └── html-renderer.mjs  # 服务端 HTML 渲染（运行列表 + 对比报告）
├── index.mjs              # cc-viewer 插件入口（被动采集 + 报告服务）
├── verify.mjs             # 插件单元验证脚本（17 项检查）
├── skill-eval.mjs         # 早期独立脚本（已被 eval-cli.mjs + lib/ 替代）
├── eval-samples.zh.json   # 评测样本集
├── skills/                # 示例 skill 定义
│   ├── v1.md              # 简单版 system prompt
│   └── v2.md              # 结构化版 system prompt
└── README.md
```

## 快速开始

### 1. 准备 skill 版本

在 `skills/` 目录下放置不同版本的 system prompt，文件名即版本标识：

```
skills/v1.md    # 简单版本
skills/v2.md    # 优化版本
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

# 运行评测（默认通过 ccv 走 cc-viewer）
node eval-cli.mjs --variants v1,v2

# 不走 cc-viewer（直接用 claude CLI）
CCV_EVAL_BIN=claude node eval-cli.mjs --variants v1,v2

# 指定样本和 skill 目录
node eval-cli.mjs \
  --variants v1,v2 \
  --samples eval-samples.zh.json \
  --skill-dir skills
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

如果 cc-viewer 已安装本插件（见下方"cc-viewer 集成"），报告服务会随 cc-viewer 自动启动。

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
| `CCV_EVAL_BIN` | 执行后端，默认 `ccv`（经过 cc-viewer），设为 `claude` 可直连 |
| `CCV_INSIGHT_PORT` | 报告服务端口，默认 `7799` |

## 评测方法论

- **控制变量**：模型固定，只改变 skill（system prompt）
- **配对设计**：同一 sample_id 在所有 variant 下执行，消除样本难度差异
- **交替调度**：s1-v1 → s1-v2 → s2-v1 → s2-v2，降低时序偏差
- **多维度量**：质量（LLM 评分）、成本（token）、效率（延迟）、稳定性（错误率）
- **LLM 评分**：使用 haiku 作为 judge 模型，基于 rubric 对输出打分（1-5 分）

## cc-viewer 集成

本工具以 cc-viewer 插件形态交付，与 cc-viewer 的集成体现在两个层面：

### 流量采集（自动）

评测默认通过 `ccv run -- claude -p` 执行，请求自动经过 cc-viewer 拦截器。在 cc-viewer Web UI 中可以：

- 查看每条评测请求的完整 request/response
- 查看 token 用量、缓存命中、延迟等原始指标

### 被动观测（插件）

安装插件后，cc-viewer 在日常使用中自动采集带标签的请求（`[variant:v1]`、`[sample_id:s001]` 等），按维度聚合指标，适用于长期趋势观测。

```bash
# 安装插件（整个目录）
cp -r . ~/.claude/cc-viewer/plugins/cc-insight/

# 或仅安装核心文件
mkdir -p ~/.claude/cc-viewer/plugins/cc-insight/lib
cp index.mjs ~/.claude/cc-viewer/plugins/cc-insight/
cp lib/report-server.mjs lib/html-renderer.mjs ~/.claude/cc-viewer/plugins/cc-insight/lib/

# 验证插件
node verify.mjs
```

安装后 cc-viewer 启动时会自动启动报告服务（端口 7799）。

## 报告格式

```json
{
  "id": "2026-03-21T14-52-06-v1-v2",
  "meta": {
    "variants": ["v1", "v2"],
    "model": "sonnet",
    "judgeModel": "haiku",
    "sampleCount": 3,
    "taskCount": 6,
    "totalCostUSD": 0.274679,
    "timestamp": "2026-03-21T13:32:41.167Z"
  },
  "summary": {
    "v1": { "avgScore": 5, "avgTotalTokens": 989, "avgDurationMs": 14756, "totalCostUSD": 0.09 },
    "v2": { "avgScore": 5, "avgTotalTokens": 1788, "avgDurationMs": 25460, "totalCostUSD": 0.11 }
  },
  "results": [
    {
      "sample_id": "s001",
      "variants": {
        "v1": { "ok": true, "score": 5, "reason": "...", "totalTokens": 1309, "durationMs": 17492, ... },
        "v2": { "ok": true, "score": 5, "reason": "...", "totalTokens": 1851, "durationMs": 26620, ... }
      }
    }
  ]
}
```

## 已验证

- 独立评测脚本端到端可用（2026-03-21）
- cc-viewer 插件 17 项检查全部通过
- 评测流量通过 ccv 成功流入 cc-viewer 日志
- 报告服务 HTML 页面渲染正常（运行列表 + 对比详情）

## 当前边界与后续方向

**当前边界：**
- 评分区分度不足：示例样本过于简单，haiku 全部打满分，需设计更有挑战性的样本和更细粒度的 rubric
- 报告服务为独立端口（7799），未嵌入 cc-viewer React UI（需作者配合）
- 不支持 `ccv eval` 子命令（需修改 cc-viewer 核心代码）

**后续方向：**
- 与 cc-viewer 作者对齐，推动 React UI 集成和 `ccv eval` 子命令
- 样本管理：从单文件演进为结构化样本库
- 多知识载体类型：从 skill 扩展到知识包、规则集等
- 统计显著性：增加置信区间和重采样统计
- 评测报告的可分享性：导出 PDF 或静态 HTML
