// 把 preset shortcut items 序列化为 onUpdatePreferences 的 API payload。
// dismissed 是 Set；为 undefined 时不写入 payload，避免覆盖服务端已有值。
export function buildPresetShortcutsPayload(items, dismissed) {
  const payload = {
    presetShortcuts: items.map(i => {
      const o = { teamName: i.teamName, description: i.description };
      if (i.builtinId) o.builtinId = i.builtinId;
      if (i.modified) o.modified = true;
      return o;
    }),
  };
  if (dismissed) payload.dismissedBuiltinPresets = [...dismissed];
  return payload;
}
