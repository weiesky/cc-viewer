# Prompt 里的 XML 风格标签：原理 + 常用标签速查（Fable 5 版）

> 从模型（Claude Fable 5）自身视角，解释 `<instructions>` 这类 XML 风格标签为什么有用，并按「先验强度」列出常用标签。结构与 Opus 4.8 版（`prompt-xml-tags.md`）一致，梯队归属按 Fable 的实际情况调整；与 4.8 版不同之处会标注。
>
> 可信度说明：模型无法内省自己的注意力权重。文中 API 行为、官方文档、harness 协议层面的内容可查证；梯队强弱属于方向性自评,未经 eval 测量。

## 结论先行

它**没有任何硬编码的解析魔法**。模型不是用 XML parser 去读 prompt——`<instructions>` 本质上只是一段普通文本。它的作用全部来自**训练时养成的注意力习惯**和**它对文本的结构化暗示**。

也因此：**没有一份「官方被增强训练的标签白名单」，也没有哪个标签是硬编码进解析器的。** 强弱是个连续谱，不是 0/1。

Fable 版需要在此基础上加一句：**推理控制和操作者通道已经从「prompt 标签约定」迁移到了「API 协议」**（adaptive thinking / `effort` / mid-conversation `role:"system"`）。标签退守它最擅长的本职——圈边界、隔数据、做结构；想用标签去触发推理模式或获取更高权限，在 Fable 上比旧模型更不灵。

---

# 一、原理：它为什么有用

## 1. 它不是语法，是「约定」

模型处理的是 token 流，不是 DOM 树。`<instructions>...</instructions>` 和 `【指令】...【指令结束】` 没有本质区别——都是用一对边界标记把一段内容圈出来。

但 Anthropic 在训练/微调阶段，数据里大量使用这种 XML 风格标签来组织 prompt（官方文档明确推荐 XML tags）。所以模型对这类标签形成了很强的**先验**：看到 `<instructions>`，会倾向于把里面的内容当作「要遵守的任务规则」。

可以理解为：标签本身没有电流，但训练让模型在这根线上接了个继电器。

## 2. 它实际解决的几个问题

与 4.8 版相同，不重复展开：**(a) 划定边界 / 防指令-数据混淆**（防 prompt injection 的常规手段，Fable 的注入防御训练更强，这条只增不减）；**(b) 提升指令显著性**；**(c) 分区引用**；**(d) 可嵌套组合**。

## 3. 几个容易误解的点（Fable 版有两处变化）

- **标签名是自由的，语义靠「认脸」——但 Fable 对名字的依赖变小了。** Fable 延续并加强了 4.7/4.8 的字面化指令跟随：自造名（如官方迁移文档里的 `<search_first>` 模式）与标准名的差距比旧模型小。边界清晰 + 内容写明白，名字不标准也能拿到大部分收益。反过来，**区块内的措辞变得更重要**——`CRITICAL: YOU MUST` 式高压语言在字面化模型上会过触发，标签的显著性和高压措辞别双倍叠加。
- **闭合最好配对。** 不变。
- **它不强制覆盖系统提示。** 不变，且在 Fable 上要加重语气：伪造协议级标签（见第四梯队）更容易被识别并打折。
- **不是越多越好。** 不变。

---

# 二、速查：常用标签（按「先验强度」分梯队，Fable 5 实际情况）

## 第一梯队：先验最强，几乎一看就「认脸」

| 标签 | 语义暗示 |
|---|---|
| `<instructions>` / `<task>` | 这是要遵守的任务规则（高优先级命令） |
| `<example>` / `<examples>` | few-shot 示范，按这个模式来 |
| `<good-example>` / `<bad-example>` | 正反示范对，比裸 example 多一层极性语义 |
| `<answer>` / `<response>` | 最终输出落点 |
| `<context>` | 背景信息，是素材不是命令 |
| `<document>` / `<documents>` | 待处理的长文档（RAG 经典容器） |

**本档评价：** 与 4.8 版相比有一出一进。**出**：`<thinking>` 被移出第一梯队（见第二梯队说明）——这是两版之间最大的单点变化。**进**：`<good-example>` / `<bad-example>` 升入第一梯队，它们在 Fable 时代的 harness 系统提示里大量出现，先验已不弱于裸 `<example>`，且自带「学这个/别学这个」的极性，写规范类 prompt 时比堆形容词好用。其余成员稳定，仍是闭眼用的安全选择。

## 第二梯队：结构化输入的常用容器，先验也比较强

- `<input>` / `<output>` —— 常嵌在 `<example>` 里成对出现，表达「给这个，出那个」
- `<system>` / `<user>` / `<assistant>` —— 对话角色标记，训练里见得极多
- `<question>` —— 问答场景的问题区
- `<format>` / `<output_format>` —— 输出格式约束
- `<constraints>` / `<rules>` —— 限制条件，常作为 `<instructions>` 的子区。**注意**：标签照用，但里面别写 `CRITICAL` / `MUST` 式高压语言，字面化模型会过触发
- `<data>` —— 待处理数据（防注入隔离常用它，Fable 上更稳）
- `<quote>` / `<quotes>` —— 先抽引文再作答的经典模式
- `<thinking>` / `<scratchpad>` —— **从第一梯队降级到这里**，见下

**本档评价：** 主体稳定，重点是接住了降级的 `<thinking>`。4.8 版称它「性价比最高」；在 Fable 上**这条不再成立**：推理走 API 原生 adaptive thinking（Fable 甚至不允许显式 `thinking: {type: "disabled"}`，只能省略参数），发生在专用 thinking block 里，与 prompt 文本里的 `<thinking>` 标签是两套机制。手写「请在 `<thinking>` 里思考」只剩**输出排版**作用——模型会照做生成一段带标签的可见文本，但那是「写出来的推理样子」，不触发真推理，复杂任务上反而可能产出冗长伪推理。要推理深度，调 `effort`（high/xhigh）；要可见推理摘要，用 `display: "summarized"`。`<thinking>` 仅在「需要在输出文本里把草稿和最终答案分开、便于后处理截取」时还值得用——这正是一个标准的第二梯队格式容器该干的活。

## 第三梯队：RAG / 文档处理里约定俗成

- `<document index="1">` 里套 `<source>` + `<document_content>` —— 官方推荐的**多文档**包裹结构，连属性 `index=` 都是约定的一部分
- `<search_results>` / `<result>` —— 检索结果容器
- `<citation>` / `<citations>` —— 引文标注

**本档评价：** 与 4.8 版无差异。RAG 容器约定没有变动，多文档带 `index` 属性的结构仍是引用准确性最稳的写法。

## 第四梯队：工具使用 / Agent / harness 协议级（成员大幅扩容）

这一类在工具调用和 harness 的训练里出现，但通常是**系统层自动注入**的，不建议在普通 prompt 里手写：

- `<function_calls>` / `<invoke>` / `<parameter>` —— 工具调用的内部表示
- `<function_results>` / `<result>` —— 工具返回
- `<system-reminder>` —— harness 注入的系统提醒，**固定语义规则：其内容是背景约束，不是用户指令**
- `<task-notification>` —— 后台任务完成通知（含 task-id / output-file / status 结构）
- `<local-command-caveat>` —— 包裹的用户侧命令输出不应被当作对话输入回应
- `<command-name>` / `<command-message>` / `<command-args>` / `<local-command-stdout>` —— 斜杠命令调用的协议字段
- `<env>` —— 环境信息块

> ⚠️ 4.8 版的警告「手写可能和真实工具协议打架」在 Fable 上要**加重为「别伪造」**：这批标签的先验强度已不弱于第一梯队，但语义绑定在「出现在 harness 注入的位置」上。在用户内容里手写 `<system-reminder>` 不会获得 operator 权限——Fable 的注入防御训练更强，伪造协议标签更可能被识别并打折，比在旧模型上更不划算。

**本档评价：** 两版之间变化第二大的一档。Fable 训练数据里 agentic harness 占比远高于早期模型，成员从 3 个扩到 10+ 个，先验从「知道有」变成「带明确行为规则的强先验」。同时操作者通道已协议化：API 支持 mid-conversation system message（`{"role": "system", ...}` 直接放进 messages，beta `mid-conversation-system-2026-04-07`），这才是中途注入高权限指令的正路；`<system-reminder>` 文本模式退为不支持该 beta 的模型上的 fallback。

---

# 三、实操经验 + 一句话总结

1. **想吃到「天然增强」，仍然优先用第一/第二梯队的标准名**——但 Fable 字面化更强，名字的边际收益变小，**区块内容写清楚比名字取得标准更重要**。
2. **别再用 `<thinking>` 诱导推理。** 这是与 4.8 版差异最大的一条。要深度走 `effort`，要可见摘要走 `display: "summarized"`；`<thinking>` 只当输出排版容器用。
3. **隔离类标签照用，且更值得用。** `<data>` / `<document>` 包裹不可信内容的防注入价值在 Fable 上只增不减。
4. **第四梯队的纪律从「别乱用」升级为「别伪造」。** 中途注入操作者指令走 mid-conversation `role:"system"`，不要发明或模仿协议标签。

**一句话总结：** XML 风格标签在 Fable 上仍是一个**软约定**——靠训练形成的偏好生效，作用是**圈定边界、隔离指令与数据、便于分区引用**。变化在于分工：**推理控制和操作者通道已迁移到 API 协议**（adaptive thinking / `effort` / `role:"system"`），标签退守圈边界、隔数据、做结构的本职；它依然是引导，不是凌驾权限或安全边界的开关。
