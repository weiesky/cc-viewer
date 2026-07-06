// iPadOS 13+ Safari 伪装为 Mac UA，需用 maxTouchPoints 辅助识别
const _isIPadOS = navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent);
export const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || _isIPadOS;
export const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || _isIPadOS;
