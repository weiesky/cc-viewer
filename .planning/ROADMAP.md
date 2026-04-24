# Cleffa - 项目路线图 (基于 cc-viewer)

## 里程碑概览

- ✅ **[M1: MVP Core](milestones/v1.0-ROADMAP.md)** — 6 phases, 17 files, +1559 LOC (2026-04-20 → 2026-04-22)
- ✅ **[M1.1: UI 优化](milestones/v1.1-ROADMAP.md)** — 2 phases, 选中元素 Tag + 状态栏 + 截图对比 POC + UI 打磨 (2026-04-22)
- ✅ **[M1.2: 可视化编辑体验增强](milestones/v1.2-ROADMAP.md)** — 4 phases, 默认值优化 + 终端替换 + 设计稿对比自动调整 (2026-04-23)
- ✅ **[M1.3: 优化可视区域](milestones/v1.3-ROADMAP.md)** — 2 phases, 布局重构 + 操作区折叠 + Anti-AI-Slop (2026-04-23)
- 🚧 **[M1.4: 细节修复与上下文结构化](milestones/v1.4-ROADMAP.md)** — 2 phases, iframe URL 持久化 + XML 结构化元素上下文

---

## M1.4: 细节修复与上下文结构化

### Phase 18: iframe URL 状态持久化

**Goal:** 修复可视化编辑器模式切换时 iframe URL 丢失的 bug
**Description:** 关闭可视化编辑后再打开，iframe 的 URL 会重置为初始态，而非保留之前用户修改的 URL。需要在切换 displayMode 时持久化 previewUrl 状态。
**Depends on:** Phase 15
**Status:** pending

### Phase 19: XML 结构化元素上下文替代硬编码 prompt

**Goal:** 将可视化编辑器选中元素的上下文从硬编码中文 prompt 改为 XML 结构化格式
**Description:** 当前 `buildElementContext()` 生成自然语言 prompt（"请修改以下 React 组件中的元素"），耦合了指令和数据。改用 XML 标签（如 `<selected-element>`）结构化表达截图路径、组件名、class、文件路径、选择器等信息，与用户实际输入的 prompt 分离。AI 可更灵活理解上下文，也便于扩展字段。
**Depends on:** Phase 18
**Status:** pending

---

## 后续迭代方向（M2+）

- Pipeline 场景录入与截图留痕
- 支持 Vue 项目
- 多文件修改预览
- 修改历史和撤销
- 组件库快速插入
- 样式可视化编辑
