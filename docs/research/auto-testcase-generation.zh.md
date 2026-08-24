# 自动化测试用例生成调研（面向"测分专家" UltraPlan）

> - 调研日期：2026-08-24
> - 方法：5 路并行网络调研，候选仓库全部经 GitHub 页面/API 逐条核验（存在性、star、语言、许可证、维护状态），关键事实另有独立二次抽查；star 数为当日实测约值
> - 范围：**生成**自动化测试用例（测试代码或用例文本）的仓库、skill 与文本资源。**不含**纯测试运行器/执行框架；生成+执行双属性工具会明确标注
> - 目的：为 UltraPlan 新增"测分专家"（测试分析 + 生成自动化用例）预设提供参考与设计依据

## TL;DR

- **代码级用例生成**的架构范式已收敛为 TestGen-LLM 的"生成 → 运行验证 → 只留通过且有增益的用例"闭环（qodo-cover、coverup、ChatUniTest 同构），测分专家应直接采用。
- **skill/文本侧**最贴近目标的现成品：jeffallan/claude-skills 的 `test-master`、LambdaTest/agent-skills 的 `api-to-testcase-generator`、13429837441/AutoGenTestCase 的两份中文 prompt 文本（可直接改写抄用）。
- **市场空白**：全网没有高星的"需求文档 → 表格化/Gherkin 文本用例"成品 skill——这正是测分专家的差异化机会点。
- **最重要的护栏**（有论文实证）：生成器必须防止"oracle 顺从实现"——预期结果依据需求/规范而非当前实现行为，疑似 bug 揭示用例单独标记（UTBot error suite 概念）。

---

## 一、AI/LLM 单元测试生成（10）

1. **[qodo-ai/qodo-cover](https://github.com/qodo-ai/qodo-cover)**（原 Codium-ai/cover-agent）— ⭐约 5.6k · Python · AGPL-3.0 · ⚠️ README 声明自 2025-06 起不再维护（GitHub 未设 archived 标志），导流商业版 Qodo Cover Pro
   - 简介：覆盖率引导的生成 Agent，Meta TestGen-LLM 的首个开源实现。输入源码 + Cobertura 覆盖率报告，循环"LLM 生成 → 实际运行 → 仅保留通过且提升覆盖率的测试"直至达标；支持 Python/Java/Go/JS/TS 等十余种语言。
   - 评价：该品类事实标杆，曾自主向知名开源仓库提测试 PR 并被合入；分析 prompt 与生成 prompt 分离的 TOML 模板结构、严格 YAML 输出 schema 都值得直接借鉴。缺点：已弃维护 + AGPL。
2. **[plasma-umass/coverup](https://github.com/plasma-umass/coverup)** — ⭐约 112 · Python · Apache-2.0 · 活跃（FSE 2025 论文）
   - 简介：首个在 prompt 中明确指出"哪些行/分支未覆盖"并定向生成的系统；与 LLM 对话式迭代，运行验证后增量保留；带 flaky 检测与测试污染隔离。
   - 评价：学术实现中最工程化的一个，许可友好、多模型厂商；中位行+分支覆盖率 80%。目前仅 Python/pytest。
3. **[qodo-ai/pr-agent](https://github.com/qodo-ai/pr-agent)** — ⭐约 12.7k · Python · MIT · 活跃
   - 简介：主流 PR 审查 Agent，内置 `/test <component>` 为变更组件生成单测（可配数量/框架/mock 偏好），与 `/analyze` 联动。
   - 评价：测试生成是其功能之一而非核心；生态活跃度极高，适合已有 PR 工作流的团队。注意该能力可能属商业档。
4. **[microsoft/codamosa](https://github.com/microsoft/codamosa)** — ⭐约 164 · Python · MIT/LGPL · 低维护（ICSE'23）
   - 简介：搜索式（Pynguin MOSA）与 LLM 混合：搜索陷入覆盖率平台期时调 LLM 生成新测试注入搜索。
   - 评价：混合策略经典参考实现；依赖的 Codex 模型已下线，价值在算法思路而非开箱即用。
5. **[githubnext/testpilot](https://github.com/githubnext/testpilot)** — ⭐约 566 · TypeScript · MIT · ⚠️ 已归档（2025-02）
   - 简介：GitHub Next 研究原型。为 npm 包函数生成 Mocha 测试：prompt = 测试骨架 + 函数签名/函数体 + 从项目文档挖掘的用法示例；失败时携带错误重 prompt 修复。
   - 评价："函数上下文挖掘 + 失败反馈闭环"设计被后续大量工作引用。学术后继：[neu-se/testpilot2](https://github.com/neu-se/testpilot2)（⭐约 37，chat 模型适配）。
6. **[ZJU-ACES-ISE/ChatUniTest](https://github.com/ZJU-ACES-ISE/ChatUniTest)** — ⭐约 174 · Java（Maven 插件）· 低维护（FSE'24）
   - 简介：浙大出品。"生成-验证-修复"三阶段 + 自适应焦点上下文（按规则裁剪最有价值上下文注入 prompt）；用编译/运行错误引导 LLM 修复失败测试。
   - 评价：引用 360+，半数项目覆盖率优于 EvoSuite/TestSpark；研究制品，面向复现。
7. **[JetBrains-Research/TestSpark](https://github.com/JetBrains-Research/TestSpark)** — ⭐约 86 · Kotlin/Java · MIT · 活跃
   - 简介：IntelliJ 插件，同一入口集成 LLM / EvoSuite / Kex 三种生成策略；可配 prompt 模板、注入项目内样例测试，生成后自动验证再呈现。
   - 评价：少数面向"开发者日常使用"的研究工具，IDE 交互好；研究性质、用户量小。
8. **[Pythagora-io/pythagora](https://github.com/Pythagora-io/pythagora)** — ⭐约 1.8k · JS/TS · Apache-2.0 · ⚠️ 已废弃（转向 GPT Pilot）
   - 简介：GPT-4 为 Node.js 生成 Jest 单测：AST 解析目标函数及其调用链，连同相关代码发给服务端生成。
   - 评价：早期知名项目，AST 依赖收集思路仍有参考价值；勿用于新项目。
9. **[MangoFisher/TestBrain](https://github.com/MangoFisher/TestBrain)** — ⭐约 298 · Python（Django+LangChain）· Apache-2.0 · 缓慢维护
   - 简介：中文 AI 测试用例生成 Web 平台，产出**用例文本**而非测试代码：需求/PRD → 功能/接口测试用例（多种用例设计方法、数量可配），内置用例评审/打分 Agent；DeepSeek/Qwen + Milvus RAG。
   - 评价：正好覆盖"需求 → 用例文本"分支，适合中文 QA 团队参考；个人项目级成熟度。
10. **[keploy/keploy](https://github.com/keploy/keploy)** — ⭐约 18.4k · Go · Apache-2.0 · 非常活跃
    - 简介：流量驱动生成：eBPF/代理录制真实 API 流量 → 自动生成测试用例 + 依赖 mock（可导出集成测试代码）→ 回放执行。
    - 评价：本清单星数最高；单测生成是附属特性，主定位是流量→回归测试。适合存量系统无规约时沉淀回归测试。

## 二、Skill / Prompt / 文本模板（10）

1. **[obra/superpowers](https://github.com/obra/superpowers)** — ⭐极高（六位数级）· skill 集 · MIT · 活跃
   - 简介：最热多 agent 技能框架，含 `skills/test-driven-development/SKILL.md`（RED-GREEN-REFACTOR 铁律）+ `writing-good-tests.md` 参考（好/坏测试判定、反模式表）。
   - 评价：口碑顶级，但定位是**测试纪律执行器**（教 agent 何时/按什么顺序写测试），**不做需求→用例设计推导**（无等价类/边界值等技术）。强约束配套，不是生成器。
2. **[jeffallan/claude-skills](https://github.com/jeffallan/claude-skills)** — ⭐约 11.1k · skill 集 · 活跃
   - 简介：66 个专家 skill，其中 **`skills/test-master`** 最贴近目标：生成测试文件、mock 策略、覆盖分析、测试计划与缺陷报告；带 `references/unit-testing.md` 分主题参考；配套 `playwright-expert`、`spec-miner`。
   - 评价：内容实打实（完整工作流 + 示例断言 + 参考文档）；输出偏"代码+计划"而非表格化文本用例。
3. **[LambdaTest/agent-skills](https://github.com/LambdaTest/agent-skills)** — ⭐约 0.4k · 48 个测试框架 skill · MIT · 较活跃
   - 简介：厂商 TestMu AI 出品。核心 **`api-skill/api-to-testcase-generator`**：OpenAPI/Swagger/Postman/curl/接口代码 → pytest/Jest/Mocha/JUnit/Newman/k6 套件，明确覆盖 happy path、边界、错误处理；另有 20+ BDD/Gherkin skill 与 `api-analyzer` 等辅助。
   - 评价：**"API 测试用例生成"最直接的现成 skill**，输入输出写进 frontmatter；star 少但非空壳、厂商背书。纯文本用例产出弱。
4. **[wshobson/agents](https://github.com/wshobson/agents)** — ⭐约 39.1k · 多 harness 插件市场 · 极活跃
   - 简介：社区头部 agent 插件市场，测试相关实测存在：`plugins/unit-testing`、`.cursor-plugin/plugins/tdd-workflows`、`backend-development` 的 `test-automator`/`tdd-orchestrator` agent 等。
   - 评价：量大、跨 harness、更新勤；能力分散在多插件、质量参差，需自行挑选。
5. **[anthropics/skills](https://github.com/anthropics/skills)** — ⭐极高 · 官方 skill 集 · 活跃
   - 简介：19 个官方 skill，测试相关仅 **`skills/webapp-testing`**：原生 Playwright（Python）测试本地 Web 应用（写脚本、截图、查日志、管理服务器）。
   - 评价：官方规范，可当 SKILL.md 写法范例；是 UI/E2E 测试执行/脚本工具，不是"需求→用例"生成器。
6. **[mattpocock/skills](https://github.com/mattpocock/skills)** — ⭐极高 · skill 集 · 活跃
   - 简介：TS 社区名人的 skills 集，含 `skills/engineering/tdd/SKILL.md`：red-green-refactor、按"接缝"纵向切片、好/坏测试标准（反实现耦合断言、同义反复断言）。
   - 评价：质量高、安装量大；同属 TDD 纪律型，偏 TS/前端。
7. **[VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills)** — ⭐约 31.5k · skill 目录 · 极活跃
   - 简介：1400+ skill 导航目录，测试类目最全（LambdaTest 48 个、trailofbits `property-based-testing`、microsoft Playwright Testing 等）。
   - 评价：作为持续发现测试类 skill 的**索引**价值最高；本身不含内容。
8. **[f/prompts.chat](https://github.com/f/prompts.chat)**（原 awesome-chatgpt-prompts）— ⭐极高 · prompt 文本库 · CC0 · 活跃
   - 简介：世界最大开源 prompt 库，测试相关仅 "Software QA Tester" 角色 prompt。
   - 评价：量大但偏弱——角色扮演 prompt 而非用例生成方法论；补充素材库。
9. **[PatrickJS/awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules)** — ⭐约 40.7k · .cursorrules 模板集 · 半活跃
   - 简介：最流行的 Cursor 规则库，含 testing 类规则（框架约定、AAA 模式、mock 策略）。
   - 评价：测试规则零散、非用例生成导向；素材级。
10. **[13429837441/AutoGenTestCase](https://github.com/13429837441/AutoGenTestCase)** — ⭐约 129 · 中文生成器 · 停更（2025-05）
    - 简介：中文桌面工具，仓库根目录有 **`TESTCASE_READER_SYSTEM_MESSAGE.txt` / `TESTCASE_WRITER_SYSTEM_MESSAGE.txt`** 两套完整中文 prompt（需求解读 + 用例撰写），DeepSeek 生成 + 通义千问评审，可调功能/性能/边界/回归占比，导出 Markdown/Excel。
    - 评价：工具壳意义有限，但**两份中文 prompt 文本可直接抄写改造成自有 skill**，中文需求场景最贴。

## 三、API 测试用例生成（10）

1. **[WebFuzzing/EvoMaster](https://github.com/WebFuzzing/EvoMaster)**（原 EMResearch，已迁移）— ⭐约 0.8k · Kotlin · LGPL-3.0 · 非常活跃 · ERC 200 万欧元资助，TOSEM'23/ASE'24/ICST'25
   - 简介：搜索式 API 测试生成的标杆。输入 OpenAPI（黑盒）或 JVM 字节码（白盒，可插桩 SQL/MongoDB）；支持 REST/GraphQL/gRPC/Thrift；**输出可复用测试文件**（JUnit、Python unittest、Jest）+ HTML 报告。
   - 评价：独立对比研究（10 fuzzer × 20 REST API）覆盖率与缺陷发现第一；美团、大众在用。LLM 集成测试生成的直接对标物。
2. **[microsoft/restler-fuzzer](https://github.com/microsoft/restler-fuzzer)** — ⭐约 2.9k · F#+Python · MIT · 活跃 · ICSE'19
   - 简介：微软研究院首个有状态 REST fuzzer：OpenAPI → 推断生产者-消费者依赖 → 生成并执行请求序列；输出 bug buckets、重放日志、覆盖率。
   - 评价：生成+执行双属性（不产出可复用用例文件）；云 API 可靠性/安全测试事实标准之一。
3. **[schemathesis/schemathesis](https://github.com/schemathesis/schemathesis)** — ⭐约 3.6k · Python · MIT · 非常活跃
   - 简介：基于 Hypothesis 的 PBT：OpenAPI/GraphQL schema → 运行时自动生成数千条用例（边界、负例、stateful 链路），失败自动收缩，输出 JUnit/Allure 报告。
   - 评价：用例即跑即弃不沉淀文件，但生成质量极高；社区最大（Spotify/Netflix 在用）。适合 CI 发现缺陷，不适合沉淀回归套件。
4. **[apideck-libraries/portman](https://github.com/apideck-libraries/portman)** — ⭐约 685 · TypeScript · Apache-2.0 · 活跃
   - 简介：OpenAPI → 生成 Postman collection 并注入测试（契约/变体/集成/fuzz）；collection 是持久化产物，可同步 Postman、可 Newman 执行。
   - 评价：生成优先定位清晰，Postman 生态用户广泛。
5. **[isa-group/RESTest](https://github.com/isa-group/RESTest)** — ⭐约 231 · Java · LGPL-3.0 · 活跃 · ISSTA'21
   - 简介：黑盒 REST 测试框架：OpenAPI + 测试配置 → 抽象用例 → 实例化为可执行 JUnit(RestAssured) 或 Postman 用例（生成/执行分离）；含约束求解器处理参数依赖。
   - 评价：学术成熟度高（真实 API 上 9 万+ 用例实证）；适合要可入库 JUnit 用例的 Java 团队。
6. **[Cornutum/tcases](https://github.com/Cornutum/tcases)** — ⭐约 239 · Java · MIT · 活跃
   - 简介：模型驱动组合测试生成器：OAS → TestSuite 元模型 → 按覆盖准则（n-wise/边界）生成 JUnit 测试源码，含 negative 用例。
   - 评价：纯生成器（不执行），产出可直接编译；通用组合测试工具，社区较小。
7. **[selab-gatech/autoresttest](https://github.com/selab-gatech/autoresttest)** — ⭐约 50 · Python · 维护中
   - 简介：LLM + 多智能体强化学习：OpenAPI 构图，LLM 协助建 Q-table，Q-learning 智能体在预算内生成测试值并执行（ARAT-RL 实现）。
   - 评价：学术前沿（LLM×RL），单次运行约 $0.10；成熟度有限，适合研究参考。
8. **[SeUniVr/RestTestGen](https://github.com/SeUniVr/RestTestGen)** — ⭐约 65 · Java · Apache-2.0 · 低活跃 · SCAM'21
   - 简介：OpenAPI → 操作依赖图 → 生成可执行黑盒用例并执行。
   - 评价：有论文背书但社区与更新慢，次于 RESTest/EvoMaster。
9. **[TestCraft-App/api-automation-agent](https://github.com/TestCraft-App/api-automation-agent)** — ⭐约 76 · Python · MIT · 维护中
   - 简介：LLM Agent 输入 OpenAPI 生成 pytest 风格可执行 API 测试，自带多模型基准对比。
   - 评价：轻量直接，项目新、生态未验证；适合快速 PoC。
10. **[keploy/keploy](https://github.com/keploy/keploy)** — 见第一章第 10 条（流量驱动，唯一以"流量"为输入的生成器）。

## 四、UI/E2E 测试用例生成（5）

1. **[web-infra-dev/midscene](https://github.com/web-infra-dev/midscene)** — ⭐约 14.6k · TypeScript · MIT · 非常活跃（字节跳动）
   - 简介：GUI Agent for E2E Testing：自然语言步骤（Playwright `.ai()/.aiAssert` 或 YAML flows）+ 视觉模型在运行时生成操作与断言；纯视觉驱动（截图，无需 selector），跨 Web/移动/桌面。
   - 评价：LLM UI 测试领域星数与生态第一；"生成"发生在运行时，沉淀物是 YAML flows 而非静态代码文件。
2. **[test-zeus-ai/testzeus-hercules](https://github.com/test-zeus-ai/testzeus-hercules)** — ⭐约 1.1k · Python · 活跃
   - 简介："首个开源 testing agent"：纯英文 BDD/Gherkin 特性文件 → LLM 代理运行时生成并执行 UI/API/安全/可访问性验证步骤。
   - 评价：需求文本→生成+执行一体，产出执行轨迹而非代码文件；商业 TestZeus 云的开源底座。
3. **[TencentQQGYLab/AppAgent](https://github.com/TencentQQGYLab/AppAgent)** — ⭐约 6.9k · Python · MIT · 低活跃 · AAAI'24
   - 简介：腾讯多模态智能体：截图+UI 树自主探索手机 App，生成探索文档与操作动作序列。
   - 评价：移动 LLM UI 自动化影响力最大的开源项目之一；产出是探索记录而非标准用例，常作研究基座。
4. **[honeynet/droidbot](https://github.com/honeynet/droidbot)** — ⭐约 974 · Python · MIT · 休眠 · MOBILESoft'17
   - 简介：Android 轻量 UI 引导输入生成器（Monkey 智能化替代）：UI 状态建模 → 生成交互测试输入 → 产出状态转移模型。
   - 评价：经典学术工具，已停维护，传统（非 LLM）基线参考。
5. **[yzygitzh/Humanoid](https://github.com/yzygitzh/Humanoid)** — ⭐约 135 · Python · 休眠 · TOSEM'23
   - 简介：从人类演示学习生成类人 Android GUI 测试轨迹（模仿学习）。
   - 评价：重要学术工作，仓库未维护，仅研究参考。

## 五、经典（非 LLM）生成工具 · 对照基线（9）

1. **[EvoSuite/evosuite](https://github.com/EvoSuite/evosuite)** — ⭐约 0.9k · Java · LGPL-3.0 · 低活跃 · SBST 领域被引最高工具之一
   - 简介：遗传算法（whole-suite）为 Java 类生成 JUnit 套件，以分支覆盖为优化目标；自动回归断言 + 测试最小化。
   - 评价：学术"搜索式单测生成"事实标准，几乎所有 Java 侧 LLM 论文的 baseline；生成测试可读性差、维护放缓。
2. **[randoop/randoop](https://github.com/randoop/randoop)** — ⭐约 0.6k · Java · MIT · 活跃（MIT Pacheco & Ernst）
   - 简介：反馈导向随机测试：随机生成方法调用序列，执行反馈驱动保留有价值序列，产出 JUnit 回归测试。
   - 评价：最工程化的经典生成器之一，有真实工业采用；"行为快照"式断言适合防回归，测试意图性弱。
3. **[se2p/pynguin](https://github.com/se2p/pynguin)** — ⭐约 1.4k · Python · MIT · 活跃（帕绍大学 SE2）
   - 简介：EvoSuite 式搜索生成移植到 Python（whole-suite/DynaMOSA），生成 pytest/unittest 用例。
   - 评价：Python 侧 SBST 标准 baseline，文档好；研究原型，复杂项目覆盖率有限。
4. **[klee/klee](https://github.com/klee/klee)** — ⭐约 3.0k · C++ · 活跃 · OSDI'08（斯坦福）
   - 简介：LLVM 符号虚拟机：逐路径符号执行 C/C++ 程序，自动生成可复放的具体测试输入。
   - 评价：符号执行教科书级代表（内核工具链、航天软件在用）；输出是输入数据而非测试代码，与 LLM 生成互补（高约束路径推导是 LLM 弱项、KLEE 强项）。
5. **[HypothesisWorks/hypothesis](https://github.com/HypothesisWorks/hypothesis)** — ⭐约 8.9k · Python · MPL-2.0 · 非常活跃
   - 简介：Python 属性测试事实标准：策略描述输入空间 → 运行时随机生成大量输入（含边界）→ 失败自动收缩到最小反例。
   - 评价：被 numpy、cryptography 采用；运行时生成输入、不产出测试文件，测试仍是人写的属性——与 LLM 生成正交互补。
6. **[dubzzz/fast-check](https://github.com/dubzzz/fast-check)** — ⭐约 5.1k · TypeScript · MIT · 非常活跃
   - 简介：JS/TS 生态 PBT 主流：arbitraries 生成随机输入 + 自动收缩，支持 model-based testing 与竞态检测；兼容 Jest/Vitest。
   - 评价：被 Jest、Ramda 等采用；可作 LLM 生成测试的验证深度补充层。
7. **[WebFuzzing/EvoMaster](https://github.com/WebFuzzing/EvoMaster)** — 见第三章第 1 条（API 级搜索式生成的标杆，LLM 集成测试生成的直接对标物）。
8. **[UnitTestBot/UTBotJava](https://github.com/UnitTestBot/UTBotJava)** — ⭐约 0.15k · Kotlin · Apache-2.0 · 缓慢维护（HSE + JetBrains，SBST 竞赛常客）
   - 简介：符号执行 + fuzzing 混合引擎，为 Java/Kotlin 生成 JUnit 测试，自动分类 **regression / error（故意失败、暴露真实 bug）/ timeout-crash 三类套件**；IDE 插件 + CI 集成完整。
   - 评价："error suite"概念对测分专家极具借鉴价值——产物不应只有"让现状通过"的用例。
9. **[nick8325/quickcheck](https://github.com/nick8325/quickcheck)** — ⭐约 0.8k · Haskell · 活跃 · ICFP'00
   - 简介：属性测试范式源头：人写性质，自动生成用例并最小化反例。
   - 评价：历史地位无可替代；谱系综述必须一席（Hypothesis/fast-check/jqwik 皆其后代）。

## 六、AI 测试工具的 Agent 工作流拆解（架构参考）

1. **CoverAgent（qodo-cover）**：Test Runner → Coverage Parser → Prompt Builder → AI Caller 的迭代闭环；输入分节注入（带行号源码、现有测试全文、覆盖率报告、上轮失败 stderr）；输出严格 YAML schema（`test_name/test_code/test_behavior/lines_to_cover/test_tags ∈ {happy path, edge case, other}`）；**分析类与生成类 prompt 分离**（`test_generation_prompt` / `analyze_test_run_failure` / `analyze_test_against_context` / 套件插入点与缩进对齐）；单轮最多 4 条；"每条测试 run as-is"约束。
2. **Meta TestGen-LLM**（[arXiv:2402.09171](https://arxiv.org/abs/2402.09171)，FSE'24）：LLM 只是流水线一个服务，**可验证的改进保证**是主体。过滤级联四道闸门：能编译(75%通过) → 可靠通过(57%，多次运行不 flaky) → 确实提升覆盖率(25%) → 人工评审(73% 接受率)；ensemble（多模型/多 prompt/多超参）出候选再筛。用流程而非模型能力对抗幻觉。
3. **CoverUp**（[arXiv:2403.16218](https://arxiv.org/abs/2403.16218)）：首个在 prompt 里明确给出未覆盖行/分支并定向生成的系统；覆盖率分析与对话交错迭代，约一半收益来自迭代精化（中位行覆盖 62%→81%）。
4. **ChatUniTest**（[arXiv:2305.04764](https://arxiv.org/abs/2305.04764)）：Generation–Validation–Repair 三阶段 + **adaptive focal context**（动态裁剪最有价值上下文而非塞整个文件）；报错喂回修复而非丢弃；架构分 Core（通用工作流）+ Toolchain（可插拔），`phaseType` 可复现多种已发表流水线。
5. **pr-agent /test**：PR diff 定位变更组件 → 按组件生成；prompt 全部走 TOML（Jinja2 渲染）。
6. **UTBot（传统路线对照）**：符号执行 + SMT + fuzzing；输出 regression / **error suite（故意失败、暴露真实 bug）** / timeout-crash 三类套件。
7. **⚠️ 反面论文（必读）**：[arXiv:2412.14137](https://arxiv.org/abs/2412.14137)（Waterloo）：现有工具（CoverAgent/CoverUp 在列）的 test oracle "被设计成通过"，导致**把 bug 固化为正确行为、丢弃能揭示 bug 的测试**——覆盖率达标但测不出错。这直接定义了测分专家必须规避的失败模式。
8. **现成分析型 agent 范本**：GitHub awesome-copilot（⭐约 38.2k）的 [`breakdown-test` skill](https://github.com/github/awesome-copilot/blob/main/skills/breakdown-test/SKILL.md)：ISTQB + ISO 25010 编码进工作流——测试策略 → 选设计技术建覆盖矩阵 → 质量属性定级 → 数据/环境规划 → 分层拆任务 → 估算排序 → Entry/Exit Criteria（出口含 >80% 行覆盖、>90% 分支覆盖、>95% 缺陷检出）。

## 七、测分专家应内嵌的测试设计方法论（速查）

| 方法 | 一句话 | 何时用 | 来源 |
|---|---|---|---|
| 等价类划分（EP） | 输入/输出域分等价类，每类取代表值 | 任何可枚举输入域分析的第一步 | ISTQB CTFL v4.0 §4.2.1 |
| 边界值分析（BVA） | 边界上/内/外取值，缺陷聚集于边界 | 数值范围、索引、长度、分页配额 | ISTQB §4.2.2 |
| 决策表 | 条件×动作规则矩阵，穷举并化简 | 业务规则密集（权限、折扣、审批） | ISTQB §4.2.3 |
| 状态转换 | 状态×事件×动作×结果四元组 | 订单/会话/连接等生命周期状态机 | ISTQB §4.2.4 |
| 成对/组合 | 70–95% 失效由 ≤2 参数交互触发，covering array 极小用例集 | 参数 >3 个组合不可穷举 | [NIST SP 800-142](https://csrc.nist.gov/publications/detail/sp/800-142/final)、[ACTS](https://csrc.nist.gov/projects/automated-combinatorial-testing-for-software) |
| 基于风险 | 风险清单（影响×概率）→ 按风险设计 → 动态调整 | 时间/资源受限、需求面广 | [James Bach HRBT](https://www.satisfice.com/download/heuristic-risk-based-testing)、[HTSM](https://www.satisfice.com/download/heuristic-test-strategy-model) |
| 变异测试 | 注入小变异跑套件，杀不死说明断言空转 | 生成后验证闭环的最后一环（测测试质量） | [Stryker](https://stryker-mutator.io/docs/)、MUTAP([arXiv:2506.02954](https://arxiv.org/html/2506.02954v8)) |
| 覆盖模型 | 行/分支是补缺导航信号；MC-DC 每条件独立影响（n+1 用例 vs 2ⁿ） | 白盒补缺；安全关键逻辑 | DO-178C / [CAST-10](https://www.qa-systems.com/blog/mc-dc-coverage-a-critical-technique/) |
| Testing Trophy | 静态 > 集成(主体) > 单元 > E2E(少量) | 决定"给变更写哪一层的测试" | [Kent C. Dodds](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications) |
| 属性测试（PBT） | 写不变量属性，生成器随机输入 + 收缩 | 纯函数、编解码、解析、排序、数据结构 | [Hypothesis](https://hypothesis.works/articles/what-is-property-based-testing/) |
| 测行为不测实现 | 断言可观察行为，不断言内部结构 | 选择断言对象时 | [Kent C. Dodds](https://kentcdodds.com/blog/testing-implementation-details) |

## 八、对"测分专家" UltraPlan 的设计建议

1. **两段式工作流，分析与生成解耦**：第一阶段产出结构化"测试分析报告"（测试点清单），第二阶段才生成代码。测试点固定字段：`被测行为 | 输入类（等价类/边界值）| 预期结果 | 采用方法论 | 优先级 | 所属层级`。CoverAgent 的 analyze/generate 分离结构与 breakdown-test 的"策略→覆盖矩阵→任务拆解"均已验证其价值。
2. **方法论编码为"决策规则"而非"定义清单"**：纯输入域 → EP+BVA；多条件规则 → 决策表；生命周期状态机 → 状态转换；参数 >3 组合不可穷举 → pairwise；时间紧张 → 风险表取 top-N。每条规则附 1-2 行动作模板（如 BVA：min-1/min/min+1/max-1/max/max+1）。
3. **Assured 式验证闭环（硬门禁）**：生成后必须编译/运行 → 失败把"测试代码 + stdout/stderr"喂回修复（上限 2-3 轮，超限放弃并报告原因）；覆盖率只作补缺导航信号不作质量目标；有 Stryker 时可选跑变异分数作判别力体检；标记 flaky 风险。
4. **显式反"oracle 顺从实现"条款（最重要护栏）**：预期结果依据需求/文档/不变量/可观察行为，**不得**照抄当前实现；实现与规范冲突时生成"按规范断言"的用例并单独标记为"疑似 bug 揭示用例"（UTBot error suite 概念），绝不生成让错误实现通过的测试（arXiv:2412.14137 实证的核心失败模式）。
5. **结构化输出 schema + 可审查性**：CoverAgent 式严格 schema（`test_name | test_code | test_behavior | test_tags`），每条测试带"对应分析报告第几条测试点"的反向链接，可审查"分析→用例→代码"完整映射；禁止生成需要用户再补 setup 的用例。
6. **上下文管理用 adaptive focal context**：只注入被测单元、依赖签名、现有测试文件（学命名/组织/fixture 风格）、相关 helper；生成测试与现有套件风格一致（含头格式/缩进对齐）。
7. **分层取向内嵌 trophy 语义**：区分"单测生成"与"行为/集成测试生成"两种模式，默认引导高信心层；要求用户给被测入口与场景而非实现文件；断言对象 = 可观察行为。
8. **风险驱动排序与收尾报告**：测试点按风险/优先级排序输出；收尾必须输出覆盖变化对比 + 未覆盖缺口清单 + 已知不测项（风险声明），形成可追溯闭环。

### 落地映射（本仓库结构）

- 新预设文件：`packages/content/ultraAgents/test-analysis-expert.json`（协议见该目录 README：`id`/`version`/18 语言 `title`+`description`/单语言 `content`）。
- `content` 用 `<system-reminder>` + `[SCOPED INSTRUCTION]` 风格（与 code-expert/research-expert 一致，避免二次包裹）；按上面 8 条组织：两段式工作流 → 方法论决策规则 → 验证闭环 → 反 oracle 顺从条款 → 输出 schema → 上下文约束 → 分层取向 → 收尾报告。
- 可直接抄改的素材：AutoGenTestCase 两份中文 prompt（需求解读/用例撰写）、jeffallan `test-master` 的 SKILL.md 工作流、awesome-copilot `breakdown-test` 的分析矩阵结构、CoverAgent 的输出 schema 字段。
- 校验：loader 防御性校验（id 规则、≤256KB）；参照 `test/ultra-agents-api.test.js` 的 pin 方式决定是否加等值测试。

## 附录 A：排除项汇总（各一行）

- Meta TestGen-LLM：无官方公开仓库（仅论文）；首个开源实现即 qodo-cover。
- microsoft/Pex（IntelliTest）：演化为 VS 内置功能后闭源，无公开 repo（历史先驱）。
- Diffblue Cover / Symflower / ZeroStep / mabl / Testim / Octomind / KaneAI：闭源商业产品，仅作参考。
- Stagehand / Skyvern / browser-use：智能体浏览器自动化框架，非测试用例生成。
- apiaryio/dredd（已归档）：文档校验执行器而非生成器；apigee-127/swagger-test-templates（已归档）：历史模板生成器。
- ZJU-ACES-ISE/ChatTester：早期实现，已被同组 ChatUniTest 取代。
- angr（⭐9k）：二进制安全分析平台，不产出测试套件；Jazzer：覆盖率引导 fuzzer，目标是找崩溃；javapathfinder/jpf-core：模型检查框架（生成能力在扩展中）；psycopaths/jdart（已归档）、CATG（停维护）：仅历史价值。
- MGdaasLab/WHartTest（⭐1k）：中文 AI 测试平台，但主体是接口/UI 自动化**执行平台**，超出"skill/文本"边界。
- akz4ol/spec-test-generator-skill、amilarathnayake1/LLM-BDDGeneration、skc147283/smarttestgen、dikako/chatGPT-gherkin-generator 等 0-4 星仓库：想法对口但无社区验证。
- GIST-NJU/RestCT（⭐22）、TST-Studio/tst-cli（⭐5）、SYSUSELab/KTester（⭐8）等：规模太小。
- tugkanboz/awesome-ai-testing（⭐74）：AI 测试目录，可作补充索引。
- AutoUAT/GeneUS 等论文：方法学有价值但非可直接使用的仓库素材。

## 附录 B：主要来源

- 论文：[TestGen-LLM (Meta, FSE'24)](https://arxiv.org/abs/2402.09171) · [CoverUp](https://arxiv.org/abs/2403.16218) · [ChatUniTest](https://arxiv.org/abs/2305.04764) · [CodaMosa (ICSE'23)](https://arxiv.org/abs/2211.10256) · [⚠️ oracle 顺从实证 (Waterloo)](https://arxiv.org/abs/2412.14137) · [MUTAP](https://arxiv.org/html/2506.02954v8)
- 方法论：[ISTQB CTFL v4.0](https://istqb.org/certifications/certified-tester-foundation-level-ctfl-v4-0/) · [NIST SP 800-142](https://csrc.nist.gov/publications/detail/sp/800-142/final) · [NIST ACTS](https://csrc.nist.gov/projects/automated-combinatorial-testing-for-software) · [HRBT](https://www.satisfice.com/download/heuristic-risk-based-testing) · [HTSM](https://www.satisfice.com/download/heuristic-test-strategy-model) · [Testing Trophy](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications) · [Testing Implementation Details](https://kentcdodds.com/blog/testing-implementation-details) · [PBT 是什么](https://hypothesis.works/articles/what-is-property-based-testing/)
- 索引：[VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) · [tugkanboz/awesome-ai-testing](https://github.com/tugkanboz/awesome-ai-testing)
