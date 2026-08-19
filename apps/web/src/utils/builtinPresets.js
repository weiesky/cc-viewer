/**
 * 内置预置快捷方式。
 *
 * builtinId 跨版本不变，用于追踪用户的删除/编辑。
 * teamName / description 是 i18n key，渲染时通过 t() 解析。
 */
export const BUILTIN_PRESETS = [
  {
    builtinId: 'codereview-5',
    teamName: 'ui.preset.codeReview5.name',
    description: 'ui.preset.codeReview5.desc',
  },
  // 历史遗留 builtinId 已连同 i18n key 一并删除（用户反馈不常用）：
  //   - 'scout-regiment'  / ui.preset.scoutRegiment.*
  //   - 'codereview-2'    / ui.preset.codeReview2.*
  // 若老用户的 preset 列表里已保存这些条目，i18n key 缺失时 t() 会回显原始 key，
  // 视觉上难看但不崩；用户可在管理弹窗里手动删除。
];
