import { useEffect, useState } from 'react';
import { getProjectAlias, subscribeToAlias } from '../utils/projectAlias.js';

// React hook for reading + auto-syncing a project's alias.
//
// Usage:
//   const alias = useProjectAlias(projectName); // '' if none / blank projectName
//
// Re-reads localStorage and re-subscribes whenever `projectName` changes
// (cross-project switch). Cross-tab sync via the `storage` event and same-tab
// sync via projectAlias module's internal EventTarget — both wired in
// subscribeToAlias.
//
// Why a hook (not duplicating the wiring in AppHeader / Mobile / AppBase): the
// effect logic is identical and prone to drift if copy-pasted; class
// components can host this via a tiny functional sub-component if they need to.
export function useProjectAlias(projectName) {
  const [alias, setAlias] = useState(() => getProjectAlias(projectName));

  useEffect(() => {
    // Initial read on mount AND on projectName change — covers project switch.
    setAlias(getProjectAlias(projectName));
    if (!projectName) return undefined;
    const off = subscribeToAlias(projectName, (next) => setAlias(next || ''));
    return off;
  }, [projectName]);

  return alias;
}
