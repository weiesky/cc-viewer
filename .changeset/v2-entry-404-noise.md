---
"cc-viewer": patch
---

fix(server): **/api/v2-entry 的预期内 404 不再刷 stderr** — 点开请求列表某条 v3 行详情时，若该会话目录已被 quota 剪枝 / `/clear` 清理，`validateLogPath` 抛 NOT_FOUND，此前被 `console.error` 当异常打进终端（一条预期内的「详情目标已不存在」）；现 NOT_FOUND 不再上报（404 照常返回前端，前端有兜底），只有真异常（ACCESS_DENIED / 500）才打 console。Coverage: `v2-entry-endpoint.test.js`.
