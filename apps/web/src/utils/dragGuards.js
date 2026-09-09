// antd Modal/Drawer/Image-preview portals mount under document.body (outside
// #root and outside the Layout that carries the global drop handlers), but
// React bubbles their synthetic drag events through the opener's component
// tree (FileExplorer → ChatView → Layout). Detecting the event target keeps
// the global drag handling — and the sidebar's container handlers — inert
// while the pointer is over such a portal.
//
// Target-based (not "is any modal open") on purpose: rc-dialog keeps the
// portal mounted after close (autoDestroy:false, hidden via display:none),
// so a DOM-presence check would false-positive forever.
const PORTAL_SELECTOR = '.ant-modal-root, .ant-drawer, .ant-image-preview-root';

export function isOverModalPortal(e) {
  return !!(e && e.target && e.target.closest && e.target.closest(PORTAL_SELECTOR));
}
