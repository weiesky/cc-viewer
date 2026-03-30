# Why Are Tools Listed First?

In cc-viewer's Context panel, **Tools appear before System Prompt and Messages**. This ordering precisely mirrors the **Anthropic API's KV-Cache prefix sequence**.

## KV-Cache Prefix Sequence

When Anthropic's API constructs the KV-Cache, it concatenates context into a prefix in this **fixed order**:

```
┌─────────────────────────────────────────────────┐
│ 1. Tools (JSON Schema definitions)               │  ← Start of cache prefix
│ 2. System Prompt                                 │
│ 3. Messages (conversation history + current turn)│  ← End of cache prefix
└─────────────────────────────────────────────────┘
```

This means **Tools sit before System Prompt at the very beginning of the cache prefix**.

## Why Do Tools Have Higher Cache Weight Than System?

In KV-Cache prefix matching, **earlier content is more critical** — any change invalidates everything after it:

1. **Prefix matching starts from the beginning**: The KV-Cache compares the current request against the cached prefix token-by-token from the start. The moment a mismatch is found, all subsequent content is invalidated.

2. **Tools change = entire cache invalidated**: Since Tools come first, any change to tool definitions (even adding or removing a single MCP tool) **breaks the prefix from the very start**, invalidating all cached System Prompt and Messages.

3. **System change = Messages cache invalidated**: System Prompt sits in the middle, so its changes only invalidate the Messages portion that follows.

4. **Messages change = only the tail affected**: Messages are at the end, so appending new messages only invalidates a small trailing segment — Tools and System cache remain intact.

## Practical Impact

| Change Type | Cache Impact | Typical Scenario |
|-------------|-------------|-----------------|
| Tool added/removed | **Full invalidation** | MCP server connect/disconnect, IDE plugin toggle |
| System Prompt change | Messages cache lost | CLAUDE.md edit, system reminder injection |
| New message appended | Tail increment only | Normal conversation flow (most common, cheapest) |

This is why `tools_change` in [CacheRebuild](CacheRebuild.md) tends to be the most expensive rebuild reason — it breaks the prefix chain at the very front.

## Why Are Tool Definitions Placed Before the "Brain"?

From a caching perspective, Tools being first is a technical fact. But from a cognitive design perspective, this ordering is equally logical — **Tools are the hands and feet, System Prompt is the brain**.

Before taking action, a person needs to perceive what limbs and tools are available. An infant doesn't first understand the rules of the world (System), then learn to reach and grab — they first sense that they have hands and feet, then gradually understand rules through interaction with the environment. Similarly, an LLM needs to know what tools it can call (read files, write code, search, execute commands) before receiving task instructions (System Prompt), so it can accurately assess "what can I do" and "how should I do it" when processing the instructions.

If reversed — first telling the model "your task is to refactor this module", then telling it "you have Read, Edit, Bash tools" — the model would lack critical capability boundary information when understanding the task, potentially producing unrealistic plans or overlooking available approaches.

**Know what cards you hold before deciding how to play.** This is the cognitive logic behind Tools preceding System.

## Why Are MCP Tools Also in This Position?

MCP (Model Context Protocol) tools, like built-in tools, are placed at the very front of the Tools area. Understanding MCP's position in the context helps evaluate its real benefits and costs.

### MCP Advantages

- **Capability extension**: MCP lets models access external services (database queries, API calls, IDE operations, browser control, etc.), breaking beyond built-in tool boundaries
- **Open ecosystem**: Anyone can implement an MCP server; the model gains new capabilities without retraining
- **On-demand loading**: MCP servers can be selectively connected/disconnected based on task scenario, flexibly composing tool sets

### MCP Costs

- **Cache killer**: Each MCP tool's JSON Schema definition is concatenated into the very front of the KV-Cache prefix. Adding or removing one MCP tool = **entire cache invalidated from the start**. Frequently connecting/disconnecting MCP servers will dramatically reduce cache hit rates
- **Prefix bloat**: MCP tool Schemas are typically larger than built-in tools (containing detailed parameter descriptions, enums, etc.). Many MCP tools significantly increase the Tools area's token count, squeezing the context space available for Messages
- **Latency overhead**: MCP tool calls require cross-process communication (JSON-RPC over stdio/SSE), an order of magnitude slower than built-in function calls
- **Stability risk**: MCP servers are external processes that may crash, timeout, or return unexpected formats, requiring additional error handling

### Practical Recommendations

| Scenario | Recommendation |
|----------|---------------|
| Long conversations, high-frequency interaction | Minimize MCP tool count to protect cache prefix stability |
| Short tasks, one-off operations | Use MCP tools freely; cache impact is limited |
| Frequently adding/removing MCP servers | Each change triggers full cache rebuild; consider fixing the tool set |
| Oversized Tool Schemas | Trim descriptions and enums to reduce prefix token footprint |

In cc-viewer's Context panel, MCP tools are displayed alongside built-in tools in the Tools area, giving you a clear view of each tool's Schema size and contribution to the cache prefix.
