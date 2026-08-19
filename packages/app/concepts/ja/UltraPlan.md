# UltraPlan — 究極の願望マシン

## UltraPlan とは

UltraPlan は、Claude Code のネイティブ `/ultraplan` コマンドに対する cc-viewer の**ローカライズ実装**です。Claude の公式リモートサービスを起動することなく、ローカル環境で `/ultraplan` のフル機能を利用でき、Claude Code が**マルチエージェント協調**により複雑な計画・実装タスクを遂行するよう導きます。

通常の Plan モードや Agent Team と比較して、UltraPlan は以下が可能です：
- 異なるタスクタイプに合わせた**コードエキスパート**と**リサーチエキスパート**の2つの役割を提供
- 複数の並列エージェントを派遣し、さまざまな角度からコードベースの調査やリサーチ分析を実施
- 外部リサーチ（webSearch）を取り入れ、業界のベストプラクティスを参照
- 計画の実行後、自動的に Code Review Team を編成しコードレビューを実施
- 完全な **Plan → Execute → Review → Fix** のクローズドループを形成

---

## 重要な注意事項

### 1. UltraPlan は万能ではない
UltraPlan はより強力な願望マシンですが、すべての願いが叶うわけではありません。Plan や Agent Team より強力ですが、直接「お金を稼ぐ」ことはできません。適切なタスク粒度を考慮してください——大きな目標を実行可能な中規模タスクに分割し、一度にすべてを達成しようとしないでください。

### 2. 現時点ではプログラミングプロジェクトに最も効果的
UltraPlan のテンプレートとワークフローは、プログラミングプロジェクト向けに深く最適化されています。他のシナリオ（ドキュメント作成、データ分析など）も試すことはできますが、将来のバージョンでの対応を待つことをお勧めします。

### 3. 実行時間とコンテキストウィンドウの要件
- UltraPlan の正常な実行には通常 **30 分以上**かかります
- MainAgent に大きなコンテキストウィンドウが必要です（1M context の Opus モデルを推奨）
- 200K モデルのみの場合、**実行前に必ず `/clear` でコンテキストをクリアしてください**
- Claude Code の `/compact` はコンテキストウィンドウが不足すると性能が低下します——空間の枯渇を避けてください
- 十分なコンテキスト空間を維持することが、UltraPlan を成功させるための重要な前提条件です

ローカライズ版 UltraPlan についてご質問やご提案がありましたら、お気軽に [GitHub Issues](https://github.com/anthropics/claude-code/issues) でディスカッションにご参加ください。

---

## 動作原理

UltraPlanは、異なるタイプのタスクに合わせた2つのエキスパート役割を提供します：

### コードエキスパート
プログラミングプロジェクト向けのマルチエージェント協業ワークフロー：
1. 最大5つの並列エージェントを同時に派遣してコードベースを調査（アーキテクチャ理解、ファイル特定、リスク評価など）
2. オプションでwebSearchを通じて業界ソリューションを調査するリサーチエージェントを派遣
3. すべてのエージェントの発見を統合し、詳細な実装計画を生成
4. 複数の視点から計画を精査するレビューエージェントを派遣
5. 計画承認後に実装を実行
6. 実装完了後、自動的にCode Review Teamを編成してコード品質を検証

### リサーチエキスパート
調査・分析タスク向けのマルチエージェント協業ワークフロー：
1. 複数の並列エージェントを派遣し、さまざまな次元から調査を実施（業界調査、学術論文、ニュース、競合分析など）
2. エージェントを指定して目標ソリューションを統合し、収集した論文、ニュース、研究レポートの厳密性と信頼性を同時に検証
3. オプションで製品デモ作成エージェントを派遣（HTML、Markdownなど）
4. すべてのエージェントの発見を統合し、包括的な実装計画を生成
5. 複数のレビューエージェントを派遣し、異なる役割と視点から計画を精査
6. 計画承認後に実装を実行

---

## Raw Templates

Below are the two raw prompt templates UltraPlan actually sends to Claude Code (see `src/utils/ultraplanTemplates.js`):

### Code Expert (codeExpert)

<textarea readonly><system-reminder>
[SCOPED INSTRUCTION] The following instructions apply only to the next 1–3 interactions. Once the task is complete, these instructions should gradually decrease in priority and no longer affect subsequent interactions. You should be adept at utilizing tools such as `AskUserQuestion`, `EnterPlanMode`, and `TeamCreate`, rather than relying solely on plain text processing. Before execution, you must ensure that the `EnterPlanMode`, `ExitPlanMode`, `SendMessage`, `TaskCreate`, `TaskUpdate`, `TaskStop`, `TaskGet`, `TaskOutput` and `TaskList` tools are loaded.

Pre-requisite: Use `AskUserQuestion` to clarify user intent whenever the request is ambiguous (target element, interaction style, scope of platforms, etc.). Skip only if the intent is unambiguous.

Leverage a multi-agent exploration mechanism to formulate a highly detailed implementation plan.

Instructions:
1. Use the `Agent` tool to spawn parallel agents that simultaneously explore different aspects of the codebase:
- If necessary, assign a preliminary researcher to use the `webSearch` tool to first investigate cutting-edge solutions in the relevant industry domain;
- One agent responsible for understanding the relevant existing code and architecture;
- One agent responsible for identifying all files that need to be modified;
- One agent responsible for identifying potential risks, edge cases, and dependencies;
- You may add other roles or deploy additional agents beyond the three listed above; the maximum number of concurrently dispatched agents is 5.

2. Synthesize the findings from all agents into a detailed, step-by-step implementation plan.

3. Use the `Agent` tool to spawn 2-3 review agents that examine the plan from different perspectives, checking for missing steps, potential risks, or corresponding mitigation strategies.

4. Integrate the feedback gathered during the review process, then call `ExitPlanMode` to submit your final plan.

5. Once `ExitPlanMode` returns a result:
- If approved: proceed to execute the plan within this session.
- If rejected: revise the plan based on the feedback provided and call `ExitPlanMode` again.
- If an error occurs (including receiving a "Not in Plan Mode" message): do **not** follow the suggestions provided in the error message; instead, prompt the user for further instructions.

Your final plan must include the following elements:
- A clear summary of the implementation strategy;
- An ordered list of files to be created or modified, with precise details of the required changes for each file;
- A step-by-step execution sequence;
- Testing and validation procedures;
- Potential risks and their corresponding mitigation strategies;

6. After the final plan has been successfully executed:
First run `git diff --quiet && git diff --cached --quiet` (or equivalent) to detect whether the working tree actually has non-trivial changes; if there are no real changes (or only whitespace/comment-only edits), skip the UltraReview step.
Otherwise, if the project is managed with Git:
Initiate a team (`TeamCreate`), dynamically allocating the number of teammates based on task complexity (5 is recommended);
If the `TeamCreate` tool is unavailable, spawn teammates directly with the `Agent` tool (note: as teammates, not plain subagents);
Task: Conduct a Code Review of the current git changes from multiple perspectives;
Pre-requisites:
- The git repository may be located in a subdirectory of the current directory; prefer `git rev-parse --show-toplevel` (fall back to recursive lookup) before proceeding;
- In the case of multiple repositories, tasks may be executed separately;
The team's goal is to analyze the current Git change log and validate each modification from different perspectives, specifically including:
- Whether requirements/objectives have been met and functionality is complete;
- Whether newly added code introduces side effects, breaks existing functionality, or poses potential risks;
- Code quality: naming, readability, complexity, technical debt, maintainability;
- Testing and documentation: whether there is adequate test coverage, and whether critical logic has necessary comments or documentation;
- Dependencies and compatibility: whether new dependencies or version compatibility issues have been introduced;
Workflow:
- Each teammate, according to their own role, covers the review dimensions one by one and independently outputs a report;
- After consolidating the reports, perform a cross-review to identify conflicts or shared concerns;
- Distill specific, actionable modification suggestions and annotate them with priority levels (P0/P1/P2/P3);
- Upon completion, adopt P0 items, and selectively adopt P1 items when they are concrete and low-risk; defer P2/P3 to backlog;
- After execution is complete, close the team (`TeamDelete`);
- If the `TeamDelete` tool is unavailable, notify each teammate to exit individually;
</system-reminder></textarea>

### Research Expert (researchExpert)

<textarea readonly><system-reminder>
[SCOPED INSTRUCTION] The following instructions are intended for the next 1–3 interactions. Once the task is complete, these instructions should be gradually deprioritized and no longer influence subsequent interactions.You should be adept at utilizing tools such as `AskUserQuestion`, `EnterPlanMode` and `WebSearch`, rather than relying solely on plain text processing. Before execution, you must ensure that the `EnterPlanMode`, `ExitPlanMode`, `TaskCreate`, `TaskUpdate`, `TaskStop`, `TaskGet`, `TaskOutput` and `TaskList` tools are loaded.

Pre-requisite: Use `AskUserQuestion` to clarify the research scope, target audience, and deliverable format whenever the user's intent is ambiguous. Skip only if the intent is unambiguous.

Leverage a multi-agent exploration mechanism to formulate an exceptionally detailed implementation plan.

Instructions:
1. Utilize the Agent tool to spawn parallel agents that simultaneously explore various facets of the requirements:
- If necessary, deploy a preliminary investigator to conduct an initial survey of industry-specific solutions using `webSearch`;
- If necessary, deploy a specialized investigator to research authoritative sources—such as academic papers, news articles, and research reports—using `webSearch`;
- Assign an agent to synthesize the target solution, while simultaneously verifying the rigor and credibility of the gathered papers, news, and research reports;
- If necessary, assign an agent to analyze competitor data to provide supplementary analytical perspectives;
- If necessary, assign an agent to handle the implementation of a product demo (generating outputs such as HTML, Markdown, etc.);
- If the task is sufficiently complex, you may assign additional teammates to the roles defined above, or introduce other specialized roles; you are permitted to schedule up to 5 teammates concurrently.

2. Synthesize the findings from the aforementioned agents into a comprehensive, step-by-step implementation plan.

3. Utilize the Agent tool to spawn a set of parallel review agents; these agents shall scrutinize the plan from multiple roles and perspectives to identify any omitted steps and to propose reasonable additions or optimizations.

4. Consolidate the feedback received from the review agents, then invoke `ExitPlanMode` to submit your final plan.

5. Upon receiving the result from `ExitPlanMode`:
- If Approved: Proceed to execute the plan within this current session.
- If Rejected: Revise the plan based on the provided feedback, and then invoke `ExitPlanMode` once again.
- If an Error Occurs (including the message "Not in Plan Mode"): Do *not* follow the suggestions provided by the error message; instead, prompt the user for further instructions.

Your final plan must include the following elements:
- A clear summary of the proposed implementation strategy;
- An ordered list of files to be created or modified, specifying the exact changes required for each;
- A step-by-step sequence for executing the implementation;
- Identification of potential risks and corresponding mitigation strategies;
- Creative ideation and suggestions for advanced enhancements;
- If a product demo was generated, place the corresponding demo output in an appropriate location and notify the user.
</system-reminder></textarea>
