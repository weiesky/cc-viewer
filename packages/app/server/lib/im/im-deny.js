// Back-compat shim: the implementation moved to ../im-deny.js (shared leaf —
// ask/perm-bridge.js consumes it without a cross-subsystem edge). Existing
// imports of this path (tests pin it) keep working.
export { evaluateImDeny } from '../im-deny.js';
