import { createContext } from 'react';

/**
 * Cross-tree bridge for the global approval modal.
 *
 * The inline `AskQuestionForm` (in ChatMessage) and the inline `planModeBox` PTY plan card
 * (also in ChatMessage) read this context and, when the matching id is currently active
 * in the modal AND not dismissed, render via `ReactDOM.createPortal` into the matching slot
 * div instead of inline. The component tree (and therefore the React state of the form,
 * including any in-flight feedback textarea content) is preserved across the move —
 * Portals do not unmount their children.
 *
 * Default value is a no-op: when the modal is disabled or unavailable, inline rendering
 * proceeds untouched.
 *
 * Note: permission and SDK ExitPlanMode panels deliberately stay inline-only and are NOT
 * routed through this context.
 */
export const ApprovalPortalContext = createContext({
  ptyPlanSlot: null,     // HTMLElement | null
  askSlot: null,
  // Active id for each kind — inline component compares its own id to decide whether to portal.
  // Null when modal is hidden (kind not active or dismissed).
  activePtyPlanId: null,
  activeAskId: null,
});
