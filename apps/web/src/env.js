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
// Android——用于终端渲染器选择:Android 与 macOS 桌面(longtask 守卫可用时)启用 WebGL,
// 其它平台(Windows/Linux/iOS/iPad)用 DOM 渲染器更稳定。详见 TerminalPanel WEBGL_RENDERER。
export const isAndroid = /Android/i.test(navigator.userAgent);
// Electron preload 在页面加载前注入 window.electronAPI，模块初始化时计算即可。
export const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

// 是否具备「原生整体缩放」能力 = 运行在 Electron 的 tab-content WebContentsView 内。
// 注意:tab content 注入的是 window.tabBridge(非 window.electronAPI，后者只在 workspace 视图)，
// 故这里以 tabBridge.setZoomFactor 是否存在为准。为 true → 显示「显示大小」预设下拉(走 webFrame
// .setZoomFactor 原生缩放);为 false(纯浏览器)→ 改显 (?) 提示用户用浏览器自带快捷键缩放。
export const hasNativeZoom = typeof window !== 'undefined'
  && typeof window.tabBridge?.setZoomFactor === 'function';

// Mac(⌘)vs 其它(Ctrl)——仅用于浏览器缩放提示文案选对修饰键。
export const isMac = typeof navigator !== 'undefined'
  && /Mac/i.test(navigator.platform || navigator.userAgent || '');

// Windows——终端字体栈（CJK 字形需显式落到雅黑）与 xterm 宽字形缩放仅在 Windows 启用。
export const isWindows = typeof navigator !== 'undefined'
  && /Win/i.test(navigator.platform || navigator.userAgent || '');

if (isPad) {
  document.documentElement.classList.add('pad-mode');
}
if (isMobile && isIOS && !isPad) {
  document.documentElement.classList.add('mobile-ios');
}

/**
 * 切换视图模式并重载页面。必须 reload：isPad/isMobile（本文件顶部）在模块加载时按 ccv_viewMode
 * 计算一次，决定挂载 App 还是 Mobile 树，运行期无法软切换，故写入偏好后整页重载。
 */
export function setViewMode(mode) {
  localStorage.setItem('ccv_viewMode', mode);
  location.reload();
}
