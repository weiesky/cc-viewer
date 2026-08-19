// 孤儿 tool_use：assistant 调工具但 schema/Zod safeParse 在 PreToolUse hook 之前就抛了
// InputValidationError——cc-viewer 看到 jsonl 里有 tool_use 块但底层 CLI 从未 spawn hook，
// 用户既无法答也无法干预。区分于 isPermissionDenied（用户主动拒）：前者根因在 model schema
// 与 runtime validator 不一致，后者是用户语义否决。
//
// 单独成文件让 Node test runner 可直接 import（toolResultBuilder.js 通过 helpers.js 拉了
// SVG asset import，在 jsdom-less 环境无法加载）。
export function classifyToolResultError(resultText, isError) {
  const isPermissionDenied = isError && resultText
    && /doesn't want to proceed|Permission.*denied|rejected.*tool use|interrupted by user for tool use/i.test(resultText);
  const isInputValidationError = isError && resultText
    && /InputValidationError|<tool_use_error>/i.test(resultText)
    && !isPermissionDenied;
  const isUltraplan = isPermissionDenied && resultText && /ultraplan/i.test(resultText);
  return { isPermissionDenied, isInputValidationError, isUltraplan };
}
