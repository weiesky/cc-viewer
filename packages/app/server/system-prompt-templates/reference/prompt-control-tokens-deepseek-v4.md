# DeepSeek 的控制标记（Control Tokens）：原理 + 速查（V4 版）

> 从模型（DeepSeek）自身视角，解释其 Control Tokens 机制——与 Claude 的 XML 风格标签有本质不同——并按功能分类列出所有标记。与 `prompt-xml-tags-opus-4-8.md` / `prompt-xml-tags-fable-5.md` / `prompt-control-tokens-qwen3.md` 构成同一组对照文档。
>
> 可信度说明：本版所有字面量与组装逻辑均校订自 DeepSeek-V4-Pro 官方仓库的编码模块 [`encoding/encoding_dsv4.py`](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/blob/main/encoding/encoding_dsv4.py)。早先由模型自述生成的版本中，角色标记（`你`/`我`）、定界符（`结束`）、推理标记（`反思`）、工具格式（`进行…格式…`）等均为幻觉，已全部以源码为准重写。

## 结论先行

DeepSeek 的 Control Tokens 与 Claude 的 XML 标签有**根本性的区别**：Claude 的 `<instructions>` 等标签是纯文本层面的「软约定」，依靠训练形成的注意力偏好生效，标签名可以自造；而 DeepSeek 的对话结构由**Tokenizer 级专用 Token**（如 `<｜User｜>`）和**官方编码模块硬拼装的模板**决定，字面量固定、不可替换，用户也不应手写。

V4 的体系分三层：

1. **Tokenizer 特殊 Token** —— 序列边界（BOS/EOS）、角色标记、任务标记，全角竖线 `｜` 风格；
2. **推理标记** —— `<think>` / `</think>`，thinking 模式与 chat 模式靠它切换；
3. **DSML 工具协议** —— `｜DSML｜` 锚定的 XML 变体，承载结构化工具调用。

> 简单说：Claude 用的是「暗示」，DeepSeek 用的是「指令」。

***

# 一、原理：它为什么不一样

## 1. 本质差异：文本协议 vs. 专用 Token + 硬模板

| 特性   | Claude XML Tags     | DeepSeek Control Tokens     |
| ---- | ------------------- | --------------------------- |
| 机制   | 纯文本「软约定」            | Tokenizer 特殊 Token + 编码模块拼装 |
| 实现方式 | 训练中形成的注意力偏好         | 固定字面量，编码/解码两端都做断言校验         |
| 可替换性 | 可换成 `【指令】...【指令结束】` | 不可替换，解析器按精确字面量切分            |
| 灵活性  | 高，用户可自造标签名          | 低，角色标记和协议格式完全固定             |
| 谁来写  | 用户在 prompt 里手写      | 编码模块自动注入，用户手写反而出错           |

特殊 Token 使用\*\*全角竖线 `｜`（U+FF5C）和下划块 `▁`（U+2581）\*\*拼写，如 `<｜begin▁of▁sentence｜>`。这种拼法刻意避开普通文本会出现的半角 `|` 和空格，保证用户内容永远不会「碰巧」拼出一个特殊 Token——解码器还会反向断言：模型输出的正文里不允许泄漏任何特殊 Token。

## 2. 没有 Jinja 模板：V4 用 Python 编码模块组装

V3 时代对话格式由 tokenizer\_config 里的 Jinja2 chat template 渲染；V4 改为随模型发布一个独立的 Python 编码模块（`encoding_dsv4.py`），核心入口是 `encode_messages()`。它接收 OpenAI 风格的 messages 数组，按角色逐条渲染：

```
<｜begin▁of▁sentence｜>{system 内容}{## Tools 区段（可选）}
<｜User｜>{用户内容}
<｜Assistant｜>{推理}</think>{正文}{工具调用块}<｜end▁of▁sentence｜>
<｜User｜>{用户内容}
<｜Assistant｜><think>          ← add_generation_prompt 在此触发生成
```

注意两点与直觉不同：

* **没有 system 角色标记**。system 消息就是裸文本放在序列最前面（BOS 之后），不带任何包裹标记；工具定义（`## Tools` 区段）和强制输出 schema（`## Response Format:` 区段）也是作为纯文本追加在 system 内容后面的。
* **消息边界不对称**。assistant 消息以 EOS（`<｜end▁of▁sentence｜>`）显式收尾；user 消息没有结束符，下一个角色标记本身就是边界。

## 3. 三层机制各管一段

* **角色边界**靠特殊 Token：模型从 token 层面就能区分「谁在说话」，不存在用户冒充 assistant 的文本歧义；
* **推理/回答边界**靠 `<think>`/`</think>`：thinking 与 chat 是同一个模型的两种解码起点（见第三类详解）；
* **工具调用结构**靠 DSML：一种以 `｜DSML｜` 特殊标记为锚点的 XML 变体——形似 XML，但起始锚点是普通文本拼不出来的，解析器可以放心用精确匹配切分,不会和正文里恰好出现的 XML 混淆。

***

# 二、速查：DeepSeek V4 Control Tokens 分类

## 第一类：序列级 Token

| Token                   | 说明                              |
| ----------------------- | ------------------------------- |
| `<｜begin▁of▁sentence｜>` | BOS，整个 prompt 的开头（无前置上下文时注入）    |
| `<｜end▁of▁sentence｜>`   | EOS，每条 assistant 消息的结尾；也是生成停止信号 |

> `encoding_dsv4.py` 中只定义字面量，不含数字 Token ID——ID 由 tokenizer 词表决定，文档不应妄称具体数值。

## 第二类：角色标记（Role Markers）

| Token                 | 含义                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `<｜User｜>`            | 用户消息开头                                                                                              |
| `<｜Assistant｜>`       | 助手消息开头；也是 generation prompt 的触发标记                                                                   |
| `<｜latest_reminder｜>` | 「最新提醒」消息开头——位于对话末尾、向模型注入临场约束的专用通道（类似 Claude harness 的 `<system-reminder>`，但 DeepSeek 把它做成了专用 Token） |

几个角色的特殊处理规则：

* **developer 角色**：渲染为 user 消息（前缀 `<｜User｜>`），可附带工具定义和 response format 区段；开启 drop\_thinking 时,较早的 developer 消息会被整条丢弃。
* **tool 角色**：**不支持直接渲染**，编码模块会抛 `NotImplementedError`。工具结果必须先经 `merge_tool_messages()` 折叠进相邻的 user 消息，以 `<tool_result>` 内容块的形式出现（见第五类）。
* **system 角色**：无专用 Token，裸文本置顶。

## 第三类：推理标记（Thinking Tokens）

| Token      | 说明              |
| ---------- | --------------- |
| `<think>`  | 推理开始            |
| `</think>` | 推理结束，其后是面向用户的正文 |

**thinking 模式与 chat 模式的切换机制**是 V4 编码里最精巧的一处——两种模式的区别仅在 generation prompt 的最后一个标记：

```
thinking 模式：...<｜User｜>问题<｜Assistant｜><think>     ← 模型从推理写起
chat 模式：  ...<｜User｜>问题<｜Assistant｜></think>    ← think 块被「预闭合」，模型直接写正文
```

chat 模式不是「关掉」推理，而是替模型把 think 块**预先闭合**——同一个模型、同一套权重，靠解码起点的一个标记决定走不走长推理链。

配套规则：

* **drop\_thinking**：多轮对话回灌历史时，最后一个 user 消息之前的 assistant 推理内容默认被剥离（只保留 `</think>` 之后的正文），节省上下文；但只要任何消息定义了 tools，剥离就整体禁用——工具调用场景下推理链是行为依据，不能丢。
* **reasoning\_effort \= "max"**：thinking 模式下若指定最高推理力度，编码模块会在序列最前面（index 0）注入一段固定文本，开头为 `"Reasoning Effort: Absolute maximum with no shortcuts permitted."`——注意这是**纯文本注入**，不是特殊 Token，属于「软硬结合」里软的那一半。
* **解码端**：`parse_message_from_completion_text` 在 thinking 模式下以 `</think>` 切分 `reasoning_content` 与 `content`，并断言该标记必须存在。

## 第四类：DSML 工具调用协议（Tool Call Protocol）

DSML 以特殊标记 `｜DSML｜` 为锚点构造 XML 风格标签。assistant 发起工具调用的完整格式：

```
{正文（可为空）}

<｜DSML｜tool_calls>
<｜DSML｜invoke name="get_weather">
<｜DSML｜parameter name="city" string="true">北京</｜DSML｜parameter>
<｜DSML｜parameter name="days" string="false">3</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls><｜end▁of▁sentence｜>
```

要点：

* **块边界**：整个工具调用块由 `\n\n<｜DSML｜tool_calls>` 起始——解码器正是用这个序列探测「正文结束、工具调用开始」；
* **多工具**：一个 `tool_calls` 块内可并列多个 `invoke`；
* **参数类型标注**：字符串参数原样内联并标 `string="true"`；其他类型（数字、布尔、对象、数组）JSON 序列化后标 `string="false"`，解码时据此重建 JSON；
* **校验严格**：解析器逐个 invoke 提取函数名和参数对，拒绝重复参数和畸形定界符，并要求块结束后紧跟 EOS、不允许尾随内容；
* 工具的**定义**（schema 列表）不走特殊 Token，而是以纯文本 `## Tools` 区段附在 system 消息后，schema 列在 `### Available Tool Schemas` 下。

## 第五类：工具结果与任务标记

**工具结果**没有专用 Token，用普通文本标签包裹、折叠进 user 消息：

```
<｜User｜><tool_result>{工具返回内容}</tool_result>

{用户后续追问（如有）}
```

多个内容块（文本块、tool\_result 块）之间以空行连接；`encode_messages` 还会把 tool\_result 块按上一条 assistant 消息中 tool\_call 的顺序重排对齐。

**任务标记（`DS_TASK_SP_TOKENS`）**——一组内部任务专用 Token，用于触发分类/检索类内部任务，普通对话不会出现：

| Token           | 任务                                      |
| --------------- | --------------------------------------- |
| `<｜action｜>`    | action（附加在 `<｜Assistant｜><think>` 之后触发） |
| `<｜query｜>`     | query                                   |
| `<｜authority｜>` | authority                               |
| `<｜domain｜>`    | domain                                  |
| `<｜title｜>`     | title                                   |
| `<｜read_url｜>`  | read\_url                               |

***

# 三、对照：V3 / R1 → V4 的演进

| 特性   | V3 / R1 时代                               | V4                                            |
| ---- | ---------------------------------------- | --------------------------------------------- |
| 组装方式 | tokenizer\_config 内 Jinja2 chat template | 独立 Python 编码模块 `encoding_dsv4.py`             |
| 角色标记 | `<｜User｜>` / `<｜Assistant｜>`（相同）         | 相同，新增 `<｜latest_reminder｜>`                   |
| 推理标记 | R1 用 `<think>` / `</think>`，V3 无         | 全系 `<think>` / `</think>`，thinking/chat 双模式统一 |
| 工具调用 | `<｜tool▁calls▁begin｜>` 等一族专用 Token       | DSML 协议（`｜DSML｜` 锚点 + XML 风格标签）               |
| 工具结果 | `<｜tool▁output▁begin｜>` 包裹               | 文本标签 `<tool_result>`，折叠进 user 消息              |
| 推理力度 | 无                                        | `reasoning_effort="max"` 文本注入                 |

方向很清楚：**角色边界继续下沉到 Token 层，工具协议反而上浮成「特殊标记锚定的文本协议」**（DSML）——后者与 Claude 工具调用的内部表示思路趋同：既要结构化可解析，又要保留文本层的可读性和扩展性（如 `name=` / `string=` 属性）。

***

# 四、实操经验 + 一句话总结

1. **不要手写 Control Tokens。** 与 Claude 的 XML 标签不同，这些标记由编码模块自动注入；解码端会断言正文中不得出现任何特殊 Token，手写轻则被过滤，重则解析报错。通过 API 用 messages 数组传参即可。
2. **chat 模式 \= 预闭合的 think 块。** 想理解 V4 为什么「同一个模型既能深推理又能秒回」，看 generation prompt 的最后一个标记就够了：`<think>` 是推理起点，`</think>` 是跳过推理直接作答。
3. **没有 tool 角色。** 把 OpenAI 风格的 `role: "tool"` 消息直接喂给 V4 编码模块会报错——工具结果要并入 user 消息的 content\_blocks。自建网关/代理时这是最常见的踩坑点。
4. **多轮回灌注意 drop\_thinking 规则。** 默认丢弃历史推理，但定义了 tools 就全保留——上下文预算要按后者估算。
5. **DSML 的参数类型靠 `string=` 属性。** 给模型看的工具调用示例如果自己编格式（比如塞 ` ```json ` 代码块），与训练分布不符,反而劣化调用质量。

**一句话总结：** DeepSeek 的 Control Tokens 是 Tokenizer 级别的「硬」信号，由官方编码模块织入对话结构——角色边界用专用 Token 钉死，推理模式靠 `<think>`/`</think>` 的解码起点切换，工具调用走 `｜DSML｜` 锚定的结构化协议；与 Claude 的 XML 软标签分属两种哲学，用户不应也不需手动编写它们。