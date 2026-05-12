// iPadOS 13+ Safari 伪装为 Mac UA，需用 maxTouchPoints 辅助识别
const _isIPadOS = navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent);
const _params = new URLSearchParams(window.location.search);
// URL 参数 ?mobile=1 强制移动端模式
const _forceMobile = _params.get('mobile') === '1';
// URL 参数 ?ipad=1 iPad/平板模式（Mobile 布局 + PC 缩放）
const _forcePad = _params.get('ipad') === '1';
// localStorage 保存的视图模式偏好（URL 参数优先级更高）
const _savedMode = (!_forceMobile && !_forcePad) ? localStorage.getItem('ccv_viewMode') : null;
// 窄屏自动切 iPad 模式：PC UA + 无偏好 + 宽度 < 750px → 自动 pad
const _autoNarrow = !_forceMobile && !_forcePad && !_savedMode
  && !(/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) && !_isIPadOS
  && window.innerWidth < 750;

export const isPad = _forcePad || _savedMode === 'pad' || _autoNarrow;
export const isMobile = _forcePad || _forceMobile || _savedMode === 'pad' || _autoNarrow
  || (_savedMode !== 'pc' && (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || _isIPadOS));
export const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || _isIPadOS;
// Electron preload 在页面加载前注入 window.electronAPI，模块初始化时计算即可。
export const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

if (isPad) {
  document.documentElement.classList.add('pad-mode');
}
if (isMobile && isIOS && !isPad) {
  document.documentElement.classList.add('mobile-ios');
}

/** 切换视图模式并重载页面 */
export function setViewMode(mode) {
  localStorage.setItem('ccv_viewMode', mode);
  location.reload();
}
