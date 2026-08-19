// Blurred-overlay mask for the seven hamburger-menu feature modals (Log
// Management, Export user prompts, Plugin Management, CCV Process Manager,
// Messaging Integration, Hot-Switch Proxy, Edit System Prompt).
//
// Values mirror the AskUserQuestion / plan approval overlay (`.backdrop` in
// src/components/approval/ApprovalModal.module.css) — KEEP IN SYNC, guarded by
// test/modal-mask.test.js. Applied per Modal instance via the antd semantic
// `styles={{ mask }}` API: inline style, so it cannot leak to other modals —
// a global `.ant-modal-mask` rule would hit every Modal and Modal.confirm in
// the app, which is explicitly out of scope.
export const BLUR_MASK_STYLE = Object.freeze({
  background: 'rgba(0, 0, 0, 0.45)',
  backdropFilter: 'blur(2px)',
  WebkitBackdropFilter: 'blur(2px)',
});
