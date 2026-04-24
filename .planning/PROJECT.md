# Cleffa - AI 辅助可视化前端开发工具

## 项目愿景

Cleffa 是一个创新的 Web 工具，让开发者可以在浏览器中启动任意 React 项目，通过鼠标选择页面元素，结合自然语言 prompt 让 Claude 直接修改对应的源代码。通过代理劫持本地 Claude Code 端口，无需额外 API 配置即可实现 AI 能力集成。

## 当前状态

**进行中 v1.4 (M1.4 细节修复与上下文结构化)** — 2026-04-24 起

修复 iframe URL 状态持久化 bug，并将元素上下文从硬编码中文 prompt 重构为 XML 结构化格式。

<details>
<summary>v1.3 (M1.3 优化可视区域) — 2026-04-23</summary>

重构可视化编辑器布局：左侧功能菜单 + 中间上下分割（预览+操作区）+ 右侧终端。遵循 Anti-AI-Slop 设计原则。
</details>

<details>
<summary>v1.2 (M1.2 可视化编辑体验增强) — 2026-04-23</summary>

聚焦可视化编辑模式体验：默认值优化、右侧终端替换为 xterm、Sketch 设计稿对比自动调整。
</details>

<details>
<summary>v1.1 (M1.1 UI 优化) — 2026-04-22</summary>

选中元素 Tag 交互、全局状态栏、截图对比 POC、UI 质量打磨。
</details>

<details>
<summary>v1.0 (M1 MVP Core) — 2026-04-22</summary>

核心能力已就绪：项目启动器、元素选择器、DOM-源码映射、AI 修改集成、端到端流程。
</details>

## 下一里程碑目标

待定（M1.3 完成后）。候选方向：
- Pipeline 场景录入与截图留痕（M1.3 占位后实现）
- 支持 Vue 项目
- 多文件修改预览
- 修改历史和撤销
- 组件库快速插入
- 样式可视化编辑

## 技术选型

| 层级 | 技术 |
|------|------|
| 前端框架 | React + TypeScript |
| 构建工具 | Vite |
| 样式方案 | Tailwind CSS |
| 状态管理 | Zustand |
| 代理服务 | Node.js + http-proxy |
| 元素选择 | 自定义 Inspector Overlay |
| 源码映射 | React DevTools 协议 / Source Map |

## 约束条件

- MVP 阶段仅支持 React 项目
- 依赖本地已安装的 Claude Code
- 需要项目支持 Source Map 或 React DevTools

## 创建时间

2026-04-20
