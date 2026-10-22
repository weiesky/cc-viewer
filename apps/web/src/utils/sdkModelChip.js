/**
 * Pure guard for the SDK-mode model chip (input-bar ProxyChip). Extracted for testability.
 *
 * The SDK session's launch model is displayed in the SAME input-bar slot as the proxy
 * hot-switch chip, strictly as a fallback: the proxy chip — when it renders — already
 * surfaces the effective (post-rewrite) model, and per product direction hot-switching
 * takes priority. So the SDK chip shows only when the proxy chip would render NOTHING
 * (official Default / dormant / no role assignment — the case where the launch model is
 * the only model signal) AND we're in SDK mode with a known launch model.
 *
 * @param {object} args
 * @param {boolean} args.sdkMode          — whether the session runs through the Agent SDK.
 * @param {string|null} args.sdkModel     — the SDK session's launch model (from sdk-init).
 * @param {boolean} args.proxyChipVisible — whether the proxy hot-switch chip is rendering.
 * @returns {boolean} true to render the SDK model chip.
 */
export function shouldRenderSdkModelChip({ sdkMode, sdkModel, proxyChipVisible }) {
  if (!sdkMode) return false;
  if (!sdkModel) return false;
  return !proxyChipVisible;
}
