/**
 * 内置预置快捷方式。
 *
 * builtinId 跨版本不变，用于追踪用户的删除/编辑。
 * teamName / description 是 i18n key，渲染时通过 t() 解析。
 */
export const BUILTIN_PRESETS = [
  {
    builtinId: 'scout-regiment',
    version: 1,
    teamName: 'ui.preset.scoutRegiment.name',
    description: 'ui.preset.scoutRegiment.desc',
  },
  {
    builtinId: 'codereview-5',
    version: 1,
    teamName: 'ui.preset.codeReview5.name',
    description: 'ui.preset.codeReview5.desc',
  },
  {
    builtinId: 'codereview-2',
    version: 1,
    teamName: 'ui.preset.codeReview2.name',
    description: 'ui.preset.codeReview2.desc',
  },
];
