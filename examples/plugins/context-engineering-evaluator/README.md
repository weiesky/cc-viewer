# context-engineering-evaluator

知识工程/上下文工程中**知识载体的版本对比评测**工具。

## 背景

在企业知识工程实践中，团队持续迭代 skill、知识包等知识载体。当被问到"v2 比 v1 好在哪里"时，需要用客观数据回答。本工具提供可复现的评测能力，固定模型，只变知识载体，量化对比效果。

## 评测对象

- 同一 skill 的版本迭代（v1 vs v2）
- 不同 skill 的横向对比（skill-A vs skill-B）
- 其他知识载体（知识包、prompt 模板、规则集等）

## 目录结构

```
context-engineering-evaluator/
├── skill-eval.mjs          # 独立评测脚本（主入口）
├── eval-samples.zh.json    # 评测样本集
├── skills/                 # skill 版本定义（system prompt）
│   ├── v1.md
│   └── v2.md
├── index.mjs               # cc-viewer 插件（被动采集模式）
├── verify.mjs              # 插件单元验证脚本
└── README.md
```

## 快速开始：独立评测

通过 `claude -p` 驱动评测，无需 cc-viewer，无需 API Key（使用 Claude CLI 认证）。

### 1. 准备 skill 版本

在 `skills/` 目录下放置不同版本的 system prompt：

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

字段说明：
- `sample_id`：样本唯一标识，用于配对比较
- `prompt`：用户提问
- `context`（可选）：附加上下文，会以代码块形式拼接到 prompt 后
- `rubric`（可选）：评分标准，用于 LLM 自动评分

### 3. 运行评测

```bash
# 预览模式（不实际调用）
node skill-eval.mjs --dry-run

# 运行评测
node skill-eval.mjs \
  --variants v1,v2 \
  --samples eval-samples.zh.json \
  --skill-dir skills

# 输出到文件
node skill-eval.mjs \
  --variants v1,v2 \
  --samples eval-samples.zh.json \
  --skill-dir skills \
  --output report.json
```

### 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--variants` | `v1,v2` | 要对比的版本，逗号分隔 |
| `--samples` | `eval-samples.zh.json` | 样本文件路径 |
| `--skill-dir` | `skills` | skill 定义目录 |
| `--model` | `sonnet` | 被评测的模型 |
| `--output` | 无（stdout） | 报告输出文件 |
| `--no-judge` | false | 跳过 LLM 自动评分 |
| `--dry-run` | false | 只预览任务，不执行 |

### 报告格式

```json
{
  "meta": { "variants": ["v1", "v2"], "model": "sonnet", "judgeModel": "haiku", ... },
  "summary": {
    "v1": { "avgScore": 4.2, "avgTotalTokens": 989, "avgDurationMs": 14756, "totalCostUSD": 0.09, ... },
    "v2": { "avgScore": 4.8, "avgTotalTokens": 1788, "avgDurationMs": 25460, "totalCostUSD": 0.11, ... }
  },
  "results": [ { "sample_id": "s001", "variants": { "v1": { ... }, "v2": { ... } } } ]
}
```

## 评测方法论

- **控制变量**：模型固定，只改变 skill（system prompt）
- **配对设计**：同一 sample_id 在所有 variant 下执行，消除样本难度差异
- **交替调度**：s1-v1 → s1-v2 → s2-v1 → s2-v2，降低时序偏差
- **多维度量**：质量（LLM 评分）、成本（token）、效率（延迟）、稳定性（错误率）

## cc-viewer 插件（可选）

`index.mjs` 是 cc-viewer 的被动采集插件，当请求经过 cc-viewer 代理时，自动从 prompt 中提取标签并聚合指标。适用于日常使用中的长期趋势观测，非主动评测场景。

```bash
# 安装到 cc-viewer
cp index.mjs ~/.claude/cc-viewer/plugins/context-engineering-evaluator.mjs

# 验证插件
node verify.mjs
```

## 当前边界与后续方向

已验证：
- 独立评测脚本端到端可用（2026-03-21）
- cc-viewer 插件 17 项检查全部通过

待完善：
- 评分区分度：当前样本过于简单，haiku 全部打满分，需设计更有挑战性的样本和更细粒度的 rubric
- 样本管理：从单文件演进为结构化样本库
- 报告可视化：从 JSON 输出演进为可交付的对比报告
- 多知识载体类型：从 skill 扩展到知识包、规则集等
