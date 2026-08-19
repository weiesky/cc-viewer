# Qwen 的控制标记（Control Tokens）：原理 + 速查（Qwen3 版）

> 从模型（Qwen）自身视角，解释其 Control Tokens 机制——介于 Claude 的 XML 软标签与 DeepSeek 的全硬 Token 协议之间的「中间路线」——并按功能分类列出所有标记。与 `prompt-xml-tags-opus-4-8.md` / `prompt-xml-tags-fable-5.md` / `prompt-control-tokens-deepseek-v4.md` 构成同一组对照文档。
>
> 可信度说明：本文有两个来源层级——机制与定义来自官方文档 [qwen.readthedocs.io](https://qwen.readthedocs.io/en/latest/getting_started/concepts.html)（Key Concepts、Function Calling 等页）；全部 Token 字面量、ID、`special` 属性及 Jinja 模板组装逻辑，均逐项校订自 HuggingFace 官方仓库的原始 `tokenizer_config.json`（[Qwen3-8B](https://huggingface.co/Qwen/Qwen3-8B/raw/main/tokenizer_config.json) 与 [Qwen2.5-7B-Instruct](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct/raw/main/tokenizer_config.json)），非凭记忆。

## 结论先行

Qwen 的体系正好落在 Claude 与 DeepSeek 两个极端之间。Claude 的 `<instructions>` 是纯文本「软约定」，标签名可自造；DeepSeek 的对话结构由 Tokenizer 专用 Token 加官方 Python 编码模块硬拼装，字面量不可替换。Qwen 则把这两种材料**混着用**，分三层：

1. **ChatML 框架 Token（`special=true`）** —— `<|endoftext|>`、`<|im_start|>`、`<|im_end|>` 三件套，tokenizer 级硬 Token，钉死序列与回合边界；
2. **扩展常规 Token（`special=false`）** —— `<think>`/`</think>`、`<tool_call>`/`</tool_call>`、`<tool_response>`/`</tool_response>`，字面量长得像 XML 标签，词表里也有独立 ID，但**不享受特殊 Token 的待遇**——解码时不会被 `skip_special_tokens` 滤掉，刻意留在输出文本里给下游解析器切分用；
3. **纯文本协议** —— 工具 schema 的 `<tools>` 区段、Hermes 风格 JSON、`/think` `/no_think` 软开关，全是普通文本，靠训练分布生效。

组装逻辑由随模型分发的 **Jinja chat template**（藏在 `tokenizer_config.json` 里）完成——比 DeepSeek 的 Python 编码模块轻，比 Claude 的「没有模板、全靠 prompt」重。

> 简单说：Claude 全软，DeepSeek 全硬，Qwen 软硬各半——边界用硬 Token，语义用「有名分的普通 Token」。

***

# 一、原理：中间路线是怎么搭的

## 1. 三方对比

| 特性 | Claude XML Tags | Qwen Control Tokens | DeepSeek Control Tokens |
| ---- | --------------- | ------------------- | ----------------------- |
| 机制 | 纯文本「软约定」 | ChatML 硬 Token + special=false 扩展 Token + Jinja 模板 | Tokenizer 特殊 Token + Python 编码模块拼装 |
| 组装方式 | 用户在 prompt 里手写 | `tokenizer.apply_chat_template()` 渲染 | `encoding_dsv4.py` 的 `encode_messages()` |
| 可替换性 | 高，标签名可自造 | 框架 Token 固定；语义标记字面量固定但属文本层协议 | 不可替换，编码/解码两端断言校验 |
| 角色边界 | 无（靠 API messages 抽象） | `<|im_start|>{role}` 专用 Token | `<｜User｜>` 等专用 Token |
| 工具/推理标记 | XML 软标签（`<function_calls>` 等由 harness 注入） | special=false 的词表 Token（`<think>`、`<tool_call>`） | DSML 特殊标记锚点 / `<think>` |

## 2. 词表与两类 Token：special=true ≠ 「词表里有 ID」

Qwen 用字节级 BPE（Byte-level BPE，下称 BBPE），词表约 **151,643 个常规 token**（BBPE 保证无 unknown，一切文本可编码），之后追加一段连续的 added tokens。官方文档脚注特意区分了两个概念：control tokens（控制标记）与 special tokens——后者「may contain extra regular tokens」（可能包含额外的常规 token）。这句绕口的话落到 `tokenizer_config.json` 里就非常具体：

- `special: true`（如 `<|im_start|>`）：结构性控制标记。解码时 `skip_special_tokens=True` 会把它们滤掉——它们是给推理框架看的，不是给用户看的。
- `special: false`（如 `<think>`、`<tool_call>`）：**「扩展常规 Token」**。词表里有独立 ID（省 token、保证字面量原子性），但解码时**保留在输出文本里**——这是设计使然：下游解析器（vLLM 的 reasoning parser、Hermes tool parser）就靠在文本层扫这些标签来切分推理/正文/工具调用。

一眼区分：`special=true` 的一律是 `<|…|>` 半角竖线风格；`special=false` 的一律是 `<…>` 裸 XML 风格（FIM 系是例外——沿用 `<|…|>` 拼写却是 special=false，可见拼写风格只是惯例线索，最终以词表属性为准）。DeepSeek 用全角竖线 `｜` 防用户拼出特殊 Token，Qwen 的防线则是 `<|` + `|>` 组合在自然文本中极难出现——但这只防「意外拼出」，不防恶意：HF tokenizer 默认会把用户原文里出现的 added token 字面量整体编成对应 Token，边界的防注入要靠服务端清洗（见四、实操第 1 条）。

## 3. Jinja chat template：比 Python 模块轻，比无模板重

对话格式由 `tokenizer_config.json` 内嵌的 Jinja2 模板渲染（`apply_chat_template()`），模板与权重一起分发。这层选型決定了 Qwen 的几个特征：

- **逻辑透明可读**：思考块剥离、工具消息折叠等规则全写在模板里，任何人可审计（本文引用的片段均抄自原文）；
- **能力有限**：Jinja 写不了太复杂的校验，所以 Qwen 不像 DeepSeek 那样在编码/解码两端做断言——格式错误靠模型容错和下游解析器兜底；
- **框架兼容性好**：transformers / vLLM / SGLang / llama.cpp（`--jinja`）都能直接消费，不需要随模型装一个 Python 模块。

***

# 二、速查：Qwen3 Control Tokens 分类

Qwen3 词表共 26 个 added tokens（ID 151643–151668，连续段）。其中 151643–151664 共 22 个在 Qwen2.5 时代已经就位，Qwen3 新增最后 4 个（`<tool_response>` 对 + `<think>` 对）。

## 第一类：序列级 Token

| Token | ID | special | 说明 |
| --- | --- | --- | --- |
| `<|endoftext|>` | 151643 | true | eod，预训练打包序列中的文档分隔符；推理时兼任 pad_token |

bos / eos / pad / unk 的设定与直觉不同：

- **bos：没有**（`bos_token: null`）。Qwen 不在序列前置任何固定 Token；
- **eos：训练时没有**，推理时设为 `<|im_end|>`（即 eot 兼任 eos，作为生成停止信号）；
- **unk：不存在**，BBPE 从机制上消灭了未知词。

> ⚠️ 官方脚注的微调警告：**bos 千万不要设成 `<|im_start|>`**——会导致微调首轮出现双重回合开始标记，危害较大；反过来 eos 设成 `<|im_end|>` 是可接受的，末轮重复 eot 在微调中危害较小。

## 第二类：ChatML 回合标记

| Token | ID | special | 说明 |
| --- | --- | --- | --- |
| `<|im_start|>` | 151644 | true | 回合开始，后接角色名 + 换行 |
| `<|im_end|>` | 151645 | true | 回合结束；推理时的停止信号（eos） |

ChatML 格式（源自 OpenAI Python SDK v0.28.1 时代的约定，Qwen1 起沿用至今未变）：

```
<|im_start|>system
{system 内容}<|im_end|>
<|im_start|>user
{用户内容}<|im_end|>
<|im_start|>assistant
{回复}<|im_end|>
```

ChatML 的角色就三个：`system` / `user` / `assistant`；Qwen 另接受 `role:"tool"` 传工具结果，但它在序列里没有自己的回合，会被模板折叠进 user 回合（见第五类）。注意一个代际变化：**Qwen3 起没有默认 system 消息**——不传 system 就真的什么都不注入；而 Qwen2.5 的模板会自动塞入 `You are Qwen, created by Alibaba Cloud. You are a helpful assistant.`。

## 第三类：思考标记（Thinking Tokens，Qwen3 新增）

| Token | ID | special | 说明 |
| --- | --- | --- | --- |
| `<think>` | 151667 | false | 推理开始 |
| `</think>` | 151668 | false | 推理结束，其后是面向用户的正文 |

assistant 回合内的结构：

```
<|im_start|>assistant
<think>
{推理内容}
</think>

{正文}<|im_end|>
```

**硬开关 `enable_thinking`**：`add_generation_prompt=True` 时模板在序列末尾追加 `<|im_start|>assistant\n` 触发生成；若 enable_thinking 显式为 false，再**预填一个空思考块**：

```
thinking 模式：…<|im_start|>assistant\n                        ← 模型从推理写起
非思考模式：  …<|im_start|>assistant\n<think>\n\n</think>\n\n   ← think 块被「预填」
```

预填逻辑的 Jinja 原文（抄自 Qwen3-8B 模板）：

```jinja
{%- if enable_thinking is defined and enable_thinking is false %}
    {{- '<think>\n\n</think>\n\n' }}
{%- endif %}
```

这与 DeepSeek V4 chat 模式的「预闭合 think 块」**异曲同工**——都不是关掉推理，而是替模型把思考块预先写完，让它直接从正文写起。两家殊途同归，只差一个空行的姿势。

**软开关 `/think` `/no_think`**：纯文本指令，写在 user 或 system 消息里，多轮中**最近一条生效**（来源：官方 Qwen3 模型卡与 quickstart 文档；2507 分家后混合模式连同软开关一并退场）。这是三层体系里「纯文本协议」的典型样本。

**多轮历史的思考剥离**：模板会反向扫描消息，找到最后一条「真实用户提问」（被 `<tool_response>` 完整包裹的 user 消息不算），只有这个位置**之后**的 assistant 消息保留思考块，更早的历史全部剥离只留正文——节省上下文，但多步工具调用链路内的推理会被保住。核心片段：

```jinja
{%- if '</think>' in content %}
    {%- set reasoning_content = content.split('</think>')[0].rstrip('\n').split('<think>')[-1].lstrip('\n') %}
    {%- set content = content.split('</think>')[-1].lstrip('\n') %}
{%- endif %}
```

**2507 分家**：Qwen3 初版的「单模型混合思考」试验数月后，2507 系列拆成两个专用模型——Qwen3-Instruct-2507（纯对话，不再支持 enable_thinking）与 Qwen3-Thinking-2507（纯推理，模板自动注入 `<think>`，所以输出里通常只见 `</think>` 不见开标签）。

## 第四类：工具调用标记（Tool Call，Qwen2.5 起入词表）

| Token | ID | special | 说明 |
| --- | --- | --- | --- |
| `<tool_call>` | 151657 | false | 单个工具调用开始 |
| `</tool_call>` | 151658 | false | 单个工具调用结束 |

Hermes 风格：标签包 JSON，一行一个调用，多调用并列多个块：

```
<tool_call>
{"name": "get_weather", "arguments": {"city": "北京", "days": 3}}
</tool_call>
```

要点：

- `arguments` 是 **JSON 对象**，不是序列化字符串——与 OpenAI API 的字符串形式不同，模板里会对非字符串参数做 `| tojson`；
- 工具的**定义**不走 Token：模板把 JSON Schema 列表以纯文本 `# Tools` 区段（内含 `<tools>…</tools>` 包裹）追加进 system 消息——与 DeepSeek 把 `## Tools` 区段附在 system 后的做法一致，「工具 schema 是纯文本」已是两家共识；
- 官方推荐 vLLM 用 `--tool-call-parser hermes` 解析，并明确不建议对推理模型用 ReAct 停止词模板——模型可能在 `<think>` 块里就提到停止词，先切思考块再解析工具调用才是正确顺序。

## 第五类：工具结果标记（Tool Response，Qwen3 新增）

| Token | ID | special | 说明 |
| --- | --- | --- | --- |
| `<tool_response>` | 151665 | false | 单条工具结果开始 |
| `</tool_response>` | 151666 | false | 单条工具结果结束 |

工具结果**没有自己的回合**：模板把 `role:"tool"` 消息折叠进 user 回合，连续多条 tool 消息合并成**一个** user 回合，每条各自包一层标签：

```
<|im_start|>user
<tool_response>
{结果 1}
</tool_response>
<tool_response>
{结果 2}
</tool_response><|im_end|>
```

与 DeepSeek 的对照很有意思：**「工具结果伪装成 user 消息」两家完全趋同**（DeepSeek 用 `merge_tool_messages()` 折叠成 `<tool_result>` 块），但接口态度相反——Qwen 的模板**原生接受 `role:"tool"`** 并自动折叠，DeepSeek 的编码模块遇到 tool 角色直接抛 `NotImplementedError`，要求调用方自己先折叠。自建网关时，OpenAI 风格的 tool 消息可以原样透传给 Qwen 的模板；对接 DeepSeek 则必须自己先折叠。

另注：Qwen2.5 时代 `<tool_response>` 字面量只存在于模板的纯文本里，Qwen3 才把它收编进词表成为单 Token——一个「文本协议逐步下沉为 Token」的现行案例。

## 第六类：多模态与 FIM 预留 Token

Qwen 全系共享一张词表，纯文本模型也带着这些 ID（不使用），换来 Qwen / Qwen-VL / Qwen-Coder 之间词表对齐：

| 分组 | Token（ID 区间） | special | 用途 |
| --- | --- | --- | --- |
| 视觉定位 | `<|object_ref_start/end|>` `<|box_start/end|>` `<|quad_start/end|>`（151646–151651） | true | 对象引用 / 边界框 / 四边形标注（VL 系） |
| 视觉内容 | `<|vision_start/end|>` `<|vision_pad|>` `<|image_pad|>` `<|video_pad|>`（151652–151656） | true | 图像/视频内容边界与占位（VL 系） |
| 代码 FIM | `<|fim_prefix/middle/suffix/pad|>` `<|repo_name|>` `<|file_sep|>`（151659–151664） | false | Fill-in-the-Middle 补全与仓库级上下文（Coder 系） |

***

# 三、对照：Qwen 代际演进 + 三家路线图

## 代际演进

| 特性 | Qwen1 / 2 | Qwen2.5 | Qwen3 | Qwen3-2507 |
| ---- | --------- | ------- | ----- | ---------- |
| ChatML 三件套 | ✓（自 Qwen1 起未变） | ✓ | ✓ | ✓ |
| added tokens 数 | 3 | 22（+VL/FIM/tool_call） | 26（+tool_response/think） | 26 |
| 默认 system | "You are a helpful assistant." 等 | "You are Qwen, created by Alibaba Cloud…" | **无** | 无 |
| 思考标记 | 无（QwQ 为平行试验线） | 无 | `<think>`/`</think>` 入词表，混合模式 | 拆成 Instruct / Thinking 两个模型 |
| 思考开关 | — | — | enable_thinking 硬开关 + `/think` `/no_think` 软开关 | 移除，按模型选 |
| 工具调用 | prompt 层 ReAct 约定 | `<tool_call>` 入词表 + Hermes 模板 | + `<tool_response>` 入词表 | 同 Qwen3 |

趋势与 DeepSeek 殊途同归：**文本协议里被反复使用的字面量，逐代下沉为词表 Token**（tool_call → tool_response → think）；而瞬态机制（软开关）则停留在纯文本层，甚至随版本被砍掉。

## 三家路线一句话

| 模型 | 路线 | 一句话 |
| --- | --- | --- |
| Claude | 全软 | 标签是训练出来的注意力偏好，结构归 API/harness 管 |
| Qwen | 软硬各半 | 边界用硬 Token，语义标记是「有 ID 的普通 token」，组装交给 Jinja 模板 |
| DeepSeek | 全硬 | 专用 Token + 官方编码模块拼装，两端断言校验 |

***

# 四、实操经验 + 一句话总结

1. **ChatML 三件套别手写，永远走 `apply_chat_template()`。** 另一个容易忽略的注入面：HF tokenizer 对 added token 的字面量在**用户原文里也会整体匹配**——用户输入里混入 `<|im_end|>` 字面量就可能被编成控制 Token 提前断轮，服务端应当清洗或转义用户内容里的 `<|…|>` 模式。
2. **解析输出靠 special=false 的标签，别指望 `skip_special_tokens`。** `<think>`/`<tool_call>` 解码后留在文本里是故意的：先以 `</think>`（ID 151668）切分推理与正文，再在正文部分扫 `<tool_call>` 块——顺序反了会把思考里的「假调用」当真。
3. **多轮回灌不用自己剥思考。** 模板自动丢弃历史思考块（只保留最后一次真实提问之后的），上下文预算按「只留最后一轮 think」估算即可；也可以把推理放在 `reasoning_content` 字段里传（vLLM / SGLang 的 reasoning parser 输出的正是这个字段），模板两种形态都认。
4. **`role:"tool"` 直接传。** 模板会自动折叠进 user 回合并包 `<tool_response>`——这点比 DeepSeek 省心，后者要求调用方自己折叠。
5. **微调三条红线**：bos 别设 `<|im_start|>`（官方脚注明确警告）；eos 设 `<|im_end|>` 可以；别忘了 thinking 与 non-thinking 模式的官方推荐采样参数不同（temperature/top_p 为 0.6/0.95 vs 0.7/0.8，思考模式禁用贪心解码——出处为 Qwen3 模型卡的 Best Practices 一节）。

**一句话总结：** Qwen 的 Control Tokens 是「ChatML 硬框架 + special=false 软语义 + Jinja 模板组装」的中间路线——回合边界由 tokenizer 级 Token 钉死，思考与工具标记是词表里有名分、却故意留在文本层给解析器切分的常规 Token，一切拼装交给随模型分发的 chat template；恰好落在 Claude 的纯软约定与 DeepSeek 的全硬协议之间，也最能代表开源生态的主流做法。
