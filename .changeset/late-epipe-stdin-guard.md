---
"cc-viewer": patch
---

修复 server.test.js 在 CI 上反复出现的 `write EPIPE` uncaught flake：根治点在 `execWithStdin`（git check-ignore 封装）——其 `child.stdin.write/end` 此前未防护，子进程先于 stdin 写完即退出（非 git 目录 / 超时 kill / 二进制缺失）时向已关闭管道写入抛 EPIPE，冒泡成 uncaughtException（`child.on('error')` 只捕获 spawn 失败，不捕获 stdin 写入错误）。补 `child.stdin.on('error')` + write/end try/catch + 单例 settle，早退子进程优雅 resolve 不再冒泡。此前三次针对 SSE 路径的修复（await stopViewer / res.destroy / close SSE gracefully）未触达真正的 stdin pipe，故未根治。
