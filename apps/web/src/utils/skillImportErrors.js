// Map server skill-import error codes → i18n key. Single source of truth shared by
// CachePopoverContent (user-level) and ImPlatformSettings (IM-level) — each caller
// translates with its own t()/_tr(). Returns null for codes without a dedicated
// message (caller falls back to the raw server error text/status).
export function skillImportErrorKey(code) {
  switch (code) {
    case 'INVALID_TYPE': return 'ui.skills.invalidType';
    case 'MISSING_SKILL_MD': return 'ui.skills.missingSkillMd';
    case 'INVALID_FRONTMATTER': return 'ui.skills.invalidFrontmatter';
    case 'MISSING_NAME': return 'ui.skills.missingName';
    case 'INVALID_NAME': return 'ui.skills.invalidName';
    case 'MISSING_DESCRIPTION': return 'ui.skills.missingDescription';
    case 'ZIP_BOMB':
    case 'TOO_LARGE': return 'ui.skills.tooLarge';
    case 'INVALID_ZIP': return 'ui.skills.invalidZip';
    case 'EXISTS': return 'ui.skills.exists';
    // INVALID_PATH 不在映射表: 那是 file-api 的错误码,skill 导入路由从不发出;
    // 且 ui.skills.invalidPath 键不存在 —— 留着只会把原始 key 字符串显示给用户。
    default: return null;
  }
}
