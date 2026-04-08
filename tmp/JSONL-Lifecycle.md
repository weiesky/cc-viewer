# JSONL Log Lifecycle Management

> cc-viewer JSONL 日志完整生命周期流程图

```mermaid
graph TD
    subgraph Write["1. 日志写入 (interceptor.js)"]
        A["Claude Code CLI<br/>API 请求拦截"] -->|"appendFileSync<br/>JSON + \\n---\\n"| B["JSONL 日志文件<br/>~/.claude/cc-viewer/<br/>project/project_时间戳.jsonl"]
        B -->|"文件 ≥ 512MB"| C["rotateLogFile()<br/>创建新日志文件"]
        C -->|"切换 LOG_FILE"| B
    end

    subgraph Watch["2. 文件监听 (log-watcher.js)"]
        D["watchFile()<br/>500ms 轮询"] -->|"stat.size > lastByteOffset"| E["增量读取新字节<br/>openSync + readSync"]
        E --> F["pendingTail 拼接<br/>处理不完整行"]
        F -->|"按 \\n---\\n 分割"| G["JSON.parse 每条<br/>补充 PID"]
        G -->|"timestamp / url"| H["Map 去重<br/>后到覆盖"]
        H --> I["delta-reconstructor<br/>恢复完整 messages"]
    end

    subgraph SSE["3. SSE 推送 (server.js)"]
        J["/events 端点<br/>SSE 连接建立"] -->|"初始化"| K["streamRawEntriesAsync<br/>1MB 分块流式"]
        K -->|"load_start"| L["总条数通知"]
        K -->|"load_chunk"| M["分段数据<br/>entry-slim 剪枝"]
        K -->|"load_end"| N["加载完成<br/>finalize"]
        I -->|"sendToClients"| O["data 事件<br/>实时新条目"]
        P["30s 定时器"] -->|"ping"| Q["心跳保活"]
    end

    subgraph Client["4. 前端接收 (AppBase.jsx)"]
        R["EventSource<br/>SSE 连接"] -->|"onmessage"| S["_pendingEntries[]<br/>批处理缓冲"]
        S -->|"requestAnimationFrame"| T["_flushPendingEntries()<br/>rAF 节流合并"]
        T -->|"dedup"| U["timestamp / url<br/>后到覆盖"]
        U -->|"reconstructEntries"| V["Delta 重建<br/>客户端侧"]
        V -->|"_processEntries"| W["session 分组<br/>timestamp 赋值"]
        W --> X["React setState<br/>state.requests"]
    end

    subgraph Memory["5. 内存管理 (entry-slim.js)"]
        X -->|"IncrementalSlimmer"| Y{"同一 Session<br/>MainAgent?"}
        Y -->|"是"| Z["前一条 messages=[]<br/>记录 _messageCount"]
        Y -->|"否 / 新 Session"| AA["保留完整 messages<br/>重置 slimmedIndices"]
        Z --> AB["_fullEntryIndex<br/>指向最新完整 entry"]
        AB -->|"按需还原"| AC["restoreSlimmedEntry()<br/>从完整 entry 回填"]
    end

    subgraph Mobile["6. 移动端缓存 (entryCache.js)"]
        X -->|"Mobile 端"| AD["IndexedDB<br/>saveEntries()"]
        AD --> AE["Hot: 最近 30 sessions<br/>内存中"]
        AD --> AF["Cold: 更早 sessions<br/>IndexedDB 存储"]
        AE -->|"loadMoreHistory"| AG["/api/entries/page<br/>分页拉取"]
    end

    subgraph Reconnect["7. 断线重连"]
        AH["45s 无事件"] -->|"超时检测"| AI["_reconnectSSE()<br/>最多 10 次"]
        AI -->|"since=lastTs&cc=count"| AJ["增量恢复<br/>续传"]
    end

    subgraph Manage["8. 日志管理 (log-management.js)"]
        AK["UI 操作"] --> AL["/api/delete-logs<br/>批量删除"]
        AK --> AM["/api/merge-logs<br/>流式重建 + atomic rename"]
        AK --> AN["/api/download-log<br/>流式下载"]
        AK --> AO["/api/local-logs<br/>目录扫描"]
    end

    subgraph Workspace["9. 工作区管理 (workspace-registry.js)"]
        AP["workspaces.json"] -->|"register/remove"| AQ["工作区列表<br/>id, path, projectName"]
        AQ -->|"getWorkspaces"| AR["enriched<br/>logCount, totalSize"]
        AS["stats-worker"] -->|"定期统计"| AT["{project}.json<br/>preview, turns, size"]
    end

    B --> D
    J --> R
    O --> R
    Q --> R
    AJ --> R

    style Write fill:#1a3a2a,stroke:#2d5a3d,color:#c9d1d9
    style Watch fill:#1a2a3a,stroke:#2d4a5d,color:#c9d1d9
    style SSE fill:#2a1a3a,stroke:#4d2d5a,color:#c9d1d9
    style Client fill:#3a2a1a,stroke:#5a4d2d,color:#c9d1d9
    style Memory fill:#1a3a3a,stroke:#2d5a5a,color:#c9d1d9
    style Mobile fill:#3a1a2a,stroke:#5a2d4d,color:#c9d1d9
    style Reconnect fill:#2a2a1a,stroke:#4a4a2d,color:#c9d1d9
    style Manage fill:#1a2a2a,stroke:#2d4a4a,color:#c9d1d9
    style Workspace fill:#2a1a2a,stroke:#4a2d4a,color:#c9d1d9
```

## 关键数据流

| 阶段 | 模块 | 核心机制 |
|------|------|---------|
| **写入** | `interceptor.js` | appendFileSync + 512MB 轮转 |
| **监听** | `log-watcher.js` | watchFile 500ms + lastByteOffset 增量读取 |
| **解析** | `delta-reconstructor.js` | checkpoint + delta 重建完整 messages |
| **推送** | `server.js` /events | SSE load_start → load_chunk → load_end → data |
| **接收** | `AppBase.jsx` | EventSource + rAF 批处理 + dedup |
| **剪枝** | `entry-slim.js` | 同 session 只保留最新 MainAgent 完整 messages |
| **缓存** | `entryCache.js` | Mobile IndexedDB hot/cold 分层 |
| **重连** | `AppBase.jsx` | 45s 超时 → 最多 10 次 → since 参数续传 |
| **管理** | `log-management.js` | 列表 / 删除 / 合并 / 下载 |
| **工作区** | `workspace-registry.js` | workspaces.json + withLock 并发安全 |
