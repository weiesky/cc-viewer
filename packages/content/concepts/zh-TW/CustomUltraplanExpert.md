# 自訂 UltraPlan 專家 — 使用說明

## 兩個輸入框的作用

- **專家名稱**：顯示在 UltraPlan 彈窗變體列裡的按鈕標題，30 字元以內。只是一個標籤，不會被傳送給 Claude Code。
- **提示詞正文**：你的角色指令。新建專家時，編輯框已**預填**好 `<system-reminder>...</system-reminder>` 外殼及其 `[SCOPED INSTRUCTION]` 作用域宣告——**在外殼內撰寫你的角色指令**即可。cc-viewer 不會重複包殼：殼還在就原樣傳送；你刪掉了，傳送時 cc-viewer 會再補一層。

---

## 專家範本長什麼樣

所有內建專家（Code Expert / Research Expert）本質上都是一段注入到 Claude Code 上下文裡的 `<system-reminder>`。你的自訂專家會走一模一樣的管線。下面以 **Research Expert** 為例拆解給你看：

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

## 逐段解說

### 1. `[SCOPED INSTRUCTION]` 作用域宣告（外殼，已為你預填）
> The following instructions are intended for the next 1–3 interactions...

這行告訴 Claude Code：這段指令**只在未來 1–3 輪對話中強制執行**，任務完成後就淡出，不再影響後續互動。避免「專家人格」汙染到任務之外的對話。

**這一行已預填在編輯框裡——保持原樣即可，不用自己重寫。**

### 2. 首段任務定義（**這段最值得你改**）
> Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

這是整段範本的「主謂賓」：**告訴 Claude Code 要以什麼姿態、為什麼目標工作**。預設的「多代理探索 + 實作計畫」適合**軟體研發／規劃型**任務，但對許多其他場景（內容審校、資料分析、文案創意、市場研究、合規稽核……）就不貼切。

**建議你根據自己的目標改寫這一段**，比如：
- **內容審校專家**："You are a senior content reviewer specializing in {領域}. Your goal is to identify factual inaccuracies, tone inconsistencies, and structural weaknesses in the provided material."
- **競品分析專家**："Conduct a rigorous competitive analysis for {產品類別}. Produce a comparison matrix, positioning insights, and strategic recommendations."
- **文案創意專家**："Generate multiple creative copy variants for {場景}, each with distinct positioning, tone, and call-to-action strategy."

### 3. 工作流程步驟（1–5 項，**依任務複雜度適度精簡或擴充**）

Research Expert 原範本是 5 步：**探索 → 彙整 → 審查 → 提交計畫 → 執行**。這套流程自帶「多代理並行 + 交叉審查 + 計畫審批」三層保障，適合跨度大、代價高的任務。但對許多輕量任務**過重了**，建議：

- **任務簡單**（單點查詢／小修改）：刪掉多代理 agent 派遣、刪掉並行審查，直接 1 步「給出結論」。
- **任務中等**：保留「探索 → 綜合 → 審查」三步，刪掉 ExitPlanMode 環節，直接產出結果。
- **任務複雜、代價高**（大重構、多方案比較、跨多個領域研究）：保留 5 步，甚至增加「風險建模」或「方案比較矩陣」步驟。

### 4. Step 1 的子角色清單（**依領域裁剪**）

Research Expert 派了 6 種潛在角色（industry 調研員、學術研究員、綜合 + 核實、競品、Demo 產出、擴充角色）。**根據你的場景重新列清單**：
- 寫作類：可能需要「資料蒐集員 + 風格分析員 + 事實查核員」
- 資料分析：可能需要「資料清洗員 + 統計建模員 + 視覺化員」
- 程式碼稽核：可能需要「靜態掃描員 + 相依鏈稽核員 + 威脅建模員」

### 5. 最終產出清單（**對齊你的真正訴求**）

> Your final plan must include the following elements: ...

原範本要求的是「實作計畫」的 6 個要素，但你的任務產出可能是：
- 一份研究報告 → 改為「摘要 / 方法論 / 核心發現 / 限制 / 行動建議」
- 一份審校報告 → 改為「問題清單 / 嚴重度分級 / 修改建議 / 修改後示例」
- 一份比較矩陣 → 改為「面向定義 / 評分標準 / 結論 / 優選理由」

---

## 撰寫建議（TL;DR）

1. **重點改首段**：用一句話明確角色、目標、產出形式。
2. **流程依複雜度伸縮**：輕量任務 1–2 步就夠了，複雜任務才走 5 步的多代理 + 審查閉環。
3. **Step 1 的子角色依領域重寫**：預設那些（academic papers / competitor / demo）大機率不是你要的。
4. **最後的「產出清單」是 quality bar**：寫清楚你期望的輸出結構，Claude Code 會嚴格按這個產出結果。

---

## 一個改好的範例（競品分析專家）

```
<system-reminder>
[SCOPED INSTRUCTION] The following instructions apply only to the next 1–3 interactions. Once the task is complete, these instructions should gradually decrease in priority and no longer affect subsequent interactions. You should be adept at utilizing tools such as `AskUserQuestion`, `EnterPlanMode`, and `TeamCreate`, rather than relying solely on plain text processing.

You are a senior competitive intelligence analyst for {行業}. Your goal is to
produce a decision-grade competitive landscape report for the product "{我方產品}".

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

這份相比 Research Expert 原版：精簡到 4 步，子角色從 6 個減到 3 個，產出清單完全重寫成「報告章節」。
