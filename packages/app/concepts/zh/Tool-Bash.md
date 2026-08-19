# Bash

在一个持久工作目录中运行 shell 命令，并返回其 stdout/stderr。最适合用于没有专用 Claude Code 工具可替代的操作，例如运行 git、npm、docker 或构建脚本。

## 何时使用

- 执行 git 操作（`git status`、`git diff`、`git commit`、`gh pr create`）
- 运行包管理器与构建工具（`npm install`、`npm run build`、`pytest`、`cargo build`）
- 通过 `run_in_background` 在后台启动长时间运行的进程（开发服务器、watcher）
- 调用无内置对应工具的领域专用 CLI（`docker`、`terraform`、`kubectl`、`gh`）
- 当顺序重要时，用 `&&` 串联相互依赖的步骤

## 参数

- `command` (string, 必填)：要执行的 shell 命令原文。
- `description` (string, 必填)：使用主动语态的简短摘要（简单命令 5-10 词；带管道或晦涩参数的命令需提供更多上下文）。
- `timeout` (number, 可选)：毫秒级超时时间，最大 `600000`（10 分钟）。默认 `120000`（2 分钟）。
- `run_in_background` (boolean, 可选)：为 `true` 时命令在后台分离运行，完成后你会收到通知。不要自行追加 `&`。

## 示例

### 示例 1：提交前查看仓库状态
在同一消息中并行发起 `git status` 和 `git diff --stat` 两个 `Bash` 调用以快速获取上下文，然后在后续调用中组织提交。

### 示例 2：串联相互依赖的构建步骤
使用单次调用如 `npm ci && npm run build && npm test`，让每个步骤在上一个成功后才运行。只有当你故意希望后续步骤在失败后仍继续时才使用 `;`。

### 示例 3：长时间运行的开发服务器
以 `run_in_background: true` 调用 `npm run dev`。它退出时你会收到通知。不要用 `sleep` 循环轮询；失败时应诊断原因而非盲目重试。

## 注意事项

- 工作目录在多次调用间保持不变，但 shell 状态（导出的变量、shell 函数、别名）不会。请优先使用绝对路径，除非用户要求，否则避免使用 `cd`。
- 优先使用专用工具而非 shell 等价管道：用 `Glob` 代替 `find`/`ls`、`Grep` 代替 `grep`/`rg`、`Read` 代替 `cat`/`head`/`tail`、`Edit` 代替 `sed`/`awk`、`Write` 代替 `echo >` 或 heredoc，面向用户的输出使用普通助手文本而非 `echo`/`printf`。
- 任何包含空格的路径都要用双引号包裹（例如 `"/Users/me/My Project/file.txt"`）。
- 对于独立命令，请在同一条消息中并行发起多个 `Bash` 调用。仅在一个命令依赖另一个时才用 `&&` 串联。
- 超过 30000 字符的输出会被截断。若需捕获大型日志，请重定向到文件后用 `Read` 工具读取。
- 切勿使用交互式标志，如 `git rebase -i` 或 `git add -i`；它们无法通过本工具接收输入。
- 除非用户明确要求，不要跳过 git hook（`--no-verify`、`--no-gpg-sign`）或执行破坏性操作（`reset --hard`、`push --force`、`clean -f`）。
