# カスタム UltraPlan Expert — 作成ガイド

## 2 つの入力欄の役割

- **エキスパート名**：UltraPlan のバリアント行に表示されるロールボタンのラベルです（最大 30 文字）。単なる表示名であり、Claude Code に送信されることは**ありません**。
- **プロンプト本文**：あなたが書くロール指示です。新しいエキスパートを作成すると、エディタには `<system-reminder>...</system-reminder>` ラッパーと `[SCOPED INSTRUCTION]` スコープヘッダーが**あらかじめ入力された状態**で表示されます — **ロール指示はラッパーの内側に書いてください**。cc-viewer は二重に包むことはありません：ラッパーがあればそのまま送信し、削除した場合は送信時に cc-viewer が改めて 1 つ付け直します。

---

## エキスパートテンプレートはどのような構造になっているか

すべての組み込みエキスパート（Code Expert / Research Expert）は、本質的には Claude Code のコンテキストに注入される `<system-reminder>` ブロックです。あなたのカスタムエキスパートもまったく同じパイプラインを通ります。以下は **Research Expert** のテンプレートを分解したものです。

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

## セクション別の解説

### 1. `[SCOPED INSTRUCTION]` スコープヘッダー（ラッパー — あらかじめ入力済み）
> The following instructions are intended for the next 1–3 interactions...

この行は Claude Code に対して、**この指示は次の 1〜3 ターンの対話でのみ有効**であり、その後はフェードアウトすると伝えます。「エキスパートペルソナ」がタスク以外の会話に染み出すのを防ぎます。

**この行はエディタにあらかじめ入力されています — そのまま残してください。自分で書き直す必要はありません。**

### 2. 冒頭のタスク定義（**ここが最も書き換える価値のある部分です**）
> Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

これはテンプレート全体の「主語・動詞・目的語」にあたり、**Claude Code にどのような姿勢でどのような目標に向かって作業するかを伝えます**。デフォルトの「マルチエージェント探索 + 実装計画」は**ソフトウェアエンジニアリング・計画系**のタスクには適していますが、その他多くの領域（コンテンツレビュー、データ分析、コピーライティング、市場調査、コンプライアンス監査など）には不自然に感じられます。

**自分の目的に合わせてこの一文を書き換えることを強くお勧めします**。例えば：

- **コンテンツレビュアー**："You are a senior content reviewer specializing in {domain}. Your goal is to identify factual inaccuracies, tone inconsistencies, and structural weaknesses in the provided material."
- **競合アナリスト**："Conduct a rigorous competitive analysis for {product category}. Produce a comparison matrix, positioning insights, and strategic recommendations."
- **コピーライター**："Generate multiple creative copy variants for {scenario}, each with distinct positioning, tone, and call-to-action strategy."

### 3. ワークフローのステップ（1〜5 項目 — **複雑度に応じて削減または拡張してください**）

Research Expert には 5 つのステップがあります：**探索 → 統合 → レビュー → 計画提出 → 実行**。これは「マルチエージェント並列 + クロスレビュー + 計画承認」の 3 層の厳密性を強制するもので、リスクが高く範囲の広いタスクには適していますが、**軽量なタスクには過剰**です。

- **シンプルなタスク**（単一の調べ物 / 小さな修正）：マルチエージェント派遣とレビューを省略し、1 ステップで「答えを出す」だけにしましょう。
- **中程度のタスク**：「探索 → 統合 → レビュー」は残し、ExitPlanMode のやり取りは省略して、結果を直接提供します。
- **複雑でコストの高いタスク**（大規模リファクタリング、複数案の比較、複数領域にまたがる調査）：5 ステップすべてを保持し、必要に応じて「リスクモデリング」や「選択肢比較マトリクス」のステップを追加してもよいでしょう。

### 4. ステップ 1 のサブロール（**領域に合わせて調整してください**）

Research Expert は 6 つの潜在的なロール（業界スカウト、学術リサーチャー、シンセサイザー + ファクトチェッカー、競合アナリスト、デモ作成者、拡張用スロット）を列挙しています。**自分のシナリオに合わせてこのリストを書き換えてください**：

- **執筆系**："情報収集員 + スタイル分析員 + ファクトチェック員"
- **データ分析**："データクリーニングエージェント + 統計モデリングエージェント + 可視化エージェント"
- **コード監査**："静的解析エージェント + 依存関係監査員 + 脅威モデラー"

### 5. 最終成果物のチェックリスト（**実際のニーズに合わせてください**）

> Your final plan must include the following elements: ...

元のテンプレートは「実装計画」の 6 つの要素を列挙しています。あなたの成果物はまったく別のものかもしれません：

- **調査レポート** → 「エグゼクティブサマリー / 方法論 / 主要な発見 / 限界 / 行動提案」
- **レビューレポート** → 「問題リスト / 重要度評価 / 修正提案 / 修正前後の例」
- **比較マトリクス** → 「ディメンション定義 / 採点基準 / 結論 / 推奨理由」

---

## 作成のヒント（TL;DR）

1. **冒頭の一文を書き換えてください**：ロール、目的、出力形式を一行で明示します。
2. **ワークフローを柔軟に**：軽量タスクには 1〜2 ステップ、複雑なタスクの場合のみ 5 ステップの完全ループを使います。
3. **ステップ 1 のサブロールを書き換えてください**：デフォルト（学術論文 / 競合 / デモ）はおそらくあなたが望むものではありません。
4. **最後の「成果物チェックリスト」が品質基準です**：出力構造を明確に書き出してください — Claude Code はそれを厳密に守ります。

---

## リファクタリング例：Competitive Analyst

```
<system-reminder>
[SCOPED INSTRUCTION] The following instructions apply only to the next 1–3 interactions. Once the task is complete, these instructions should gradually decrease in priority and no longer affect subsequent interactions. You should be adept at utilizing tools such as `AskUserQuestion`, `EnterPlanMode`, and `TeamCreate`, rather than relying solely on plain text processing.

You are a senior competitive intelligence analyst for {industry}. Your goal is to
produce a decision-grade competitive landscape report for the product "{our product}".

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

オリジナルの Research Expert と比較すると：4 ステップに削減され、サブロールは 6 個から 3 個に減り、成果物リストは「レポートのセクション」として完全に書き換えられています。
