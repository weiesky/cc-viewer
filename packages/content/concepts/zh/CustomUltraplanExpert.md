# 自定义 UltraPlan 专家 — 使用说明

## 两个输入框的作用

- **专家名称**：显示在 UltraPlan 弹窗变体行里的按钮标题，30 字符以内。只是一个标签，不会被发送给 Claude Code。
- **提示词正文**：你的角色指令。新建专家时，编辑框已**预填**好 `<system-reminder>...</system-reminder>` 外壳及其 `[SCOPED INSTRUCTION]` 作用域声明——**在外壳内编写你的角色指令**即可。cc-viewer 不会重复包壳：壳还在就原样发送；你删掉了，发送时 cc-viewer 会再补一层。

---

## 专家模版是什么样的

所有内置专家（代码专家 / 调研专家）本质上都是一段注入到 Claude Code 上下文里的 `<system-reminder>`。你的自定义专家会走一模一样的管道。下面以**调研专家**为例拆解给你看：

```xml
<system-reminder>
[SCOPED INSTRUCTION] The following instructions are intended for the next 1–3
interactions. Once the task is complete, these instructions should be gradually
deprioritized and no longer influence subsequent interactions.

Pre-requisite: Use `AskUserQuestion` to clarify the research scope, target
audience, and deliverable format whenever the user's intent is ambiguous. Skip
only if the intent is unambiguous.

Leverage a multi-agent exploration mechanism to formulate an exceptionally
detailed implementation plan.

Instructions:
1. Utilize the Agent tool to spawn parallel agents that simultaneously explore
   various facets of the requirements:
   - If necessary, deploy a preliminary investigator to conduct an initial
     survey of industry-specific solutions using `webSearch`;
   - If necessary, deploy a specialized investigator to research authoritative
     sources—such as academic papers, news articles, and research reports—
     using `webSearch`;
   - Assign an agent to synthesize the target solution, while simultaneously
     verifying the rigor and credibility of the gathered papers, news, and
     research reports;
   - If necessary, assign an agent to analyze competitor data to provide
     supplementary analytical perspectives;
   - If necessary, assign an agent to handle the implementation of a product
     demo (generating outputs such as HTML, Markdown, etc.);
   - If the task is sufficiently complex, you may assign additional teammates
     to the roles defined above, or introduce other specialized roles; you are
     permitted to schedule up to 5 teammates concurrently.

2. Synthesize the findings from the aforementioned agents into a comprehensive,
   step-by-step implementation plan.

3. Utilize the Agent tool to spawn a set of parallel review agents; these
   agents shall scrutinize the plan from multiple roles and perspectives to
   identify any omitted steps and to propose reasonable additions or
   optimizations.

4. Consolidate the feedback received from the review agents, then invoke
   `ExitPlanMode` to submit your final plan.

5. Upon receiving the result from `ExitPlanMode`:
   - If Approved: Proceed to execute the plan within this current session.
   - If Rejected: Revise the plan based on the provided feedback, and then
     invoke `ExitPlanMode` once again.
   - If an Error Occurs: Do *not* follow the suggestions; prompt the user for
     further instructions.

Your final plan must include the following elements:
- A clear summary of the proposed implementation strategy;
- An ordered list of files to be created or modified, specifying the exact
  changes required for each;
- A step-by-step sequence for executing the implementation;
- Identification of potential risks and corresponding mitigation strategies;
- Creative ideation and suggestions for advanced enhancements;
- If a product demo was generated, place the corresponding demo output in an
  appropriate location and notify the user.
</system-reminder>
```

---

## 逐段解释

### 1. `[SCOPED INSTRUCTION]` 作用域声明（外壳，已为你预填）
> The following instructions are intended for the next 1–3 interactions...

这行告诉 Claude Code：这段指令**只在未来 1–3 轮对话中强制执行**，任务完成后就淡出，不再影响后续交互。避免"专家人格"污染到任务之外的对话。

**这一行已预填在编辑框里——保持原样即可，不用自己重写。**

### 2. 首段任务定义（**这段最值得你改**）
> Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

这是整段模板的"主谓宾"：**告诉 Claude Code 要以什么姿态、为什么目标工作**。默认的"多代理探索 + 实施计划"适合**软件研发/规划型**任务，但对很多其他场景（内容审校、数据分析、文案创意、市场研究、合规审查……）就不贴切。

**建议你根据自己的目标改写这一段**，比如：
- **内容审校专家**："You are a senior content reviewer specializing in {领域}. Your goal is to identify factual inaccuracies, tone inconsistencies, and structural weaknesses in the provided material."
- **竞品分析专家**："Conduct a rigorous competitive analysis for {产品类别}. Produce a comparison matrix, positioning insights, and strategic recommendations."
- **文案创意专家**："Generate multiple creative copy variants for {场景}, each with distinct positioning, tone, and call-to-action strategy."

### 3. 工作流步骤（1–5 项，**根据任务复杂度适当精简或扩展**）

调研专家原模板是 5 步：**探索 → 汇总 → 审查 → 提交计划 → 执行**。这套流程自带"多代理并行 + 交叉审查 + 计划审批"三层保障，适合跨度大、代价高的任务。但对很多轻量任务**过重了**，建议：

- **任务简单**（单点查询/小改动）：删掉多代理 agent 派遣、删掉并行审查，直接 1 步"给出结论"。
- **任务中等**：保留"探索 → 综合 → 审查"三步，删掉 ExitPlanMode 环节，直接产出结果。
- **任务复杂、代价高**（大重构、多方案对比、跨多个领域调研）：保留 5 步，甚至增加"风险建模"或"方案对比矩阵"步骤。

### 4. Step 1 的子角色列表（**按领域裁剪**）

调研专家派了 6 种潜在角色（industry 调研员、学术调研员、综合 + 核实、竞品、Demo 产出、扩展角色）。**根据你的场景重新列清单**：
- 写作类：可能需要"资料收集员 + 风格分析员 + 事实核查员"
- 数据分析：可能需要"数据清洗员 + 统计建模员 + 可视化员"
- 代码审计：可能需要"静态扫描员 + 依赖链审计员 + 威胁建模员"

### 5. 最终产出清单（**对齐你的真正诉求**）

> Your final plan must include the following elements: ...

原模板要求的是"实施计划"的 6 个要素，但你的任务产出可能是：
- 一份研究报告 → 改为"摘要 / 方法论 / 核心发现 / 限制 / 行动建议"
- 一份审校报告 → 改为"问题清单 / 严重度分级 / 修改建议 / 改后示例"
- 一份对比矩阵 → 改为"维度定义 / 打分标准 / 结论 / 优选理由"

---

## 写作建议（TL;DR）

1. **重点改首段**：用一句话明确角色、目标、产出形式。
2. **流程视复杂度伸缩**：轻量任务 1–2 步够了，复杂任务才走 5 步的多代理 + 审查闭环。
3. **Step 1 的子角色按领域重写**：默认那些（academic papers / competitor / demo）大概率不是你要的。
4. **最后的"产出清单"是 quality bar**：写清楚你期望的输出结构，Claude Code 会严格按这个出结果。

---

## 一个改好的例子（竞品分析专家）

```
<system-reminder>
[SCOPED INSTRUCTION] The following instructions apply only to the next 1–3 interactions. Once the task is complete, these instructions should gradually decrease in priority and no longer affect subsequent interactions. You should be adept at utilizing tools such as `AskUserQuestion`, `EnterPlanMode`, and `TeamCreate`, rather than relying solely on plain text processing.

You are a senior competitive intelligence analyst for {行业}. Your goal is to
produce a decision-grade competitive landscape report for the product "{我方产品}".

Instructions:
1. Use the Agent tool to dispatch 3 parallel investigators:
   - Market landscape agent: map the top 5–8 competitors with core positioning
   - Feature matrix agent: compile a feature-by-feature comparison using
     publicly available sources (webSearch)
   - Pricing & GTM agent: analyze pricing models, distribution channels, and
     go-to-market motions

2. Synthesize the three streams into a unified competitive report.

3. Dispatch one review agent to stress-test the report: challenge any
   assumption lacking a cited source, flag outdated data (>12 months), and
   propose one "non-obvious" insight.

4. Deliver the final report with the following sections:
   - TL;DR (3 bullets)
   - Competitor positioning map
   - Feature matrix (markdown table)
   - Pricing & GTM table
   - Top 3 strategic implications for our product
   - Caveats & data gaps
</system-reminder>
```

这份相比调研专家原版：精简到 4 步，子角色从 6 个减到 3 个，产出清单完全重写成"报告章节"。
