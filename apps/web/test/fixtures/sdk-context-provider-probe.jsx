import React from 'react';
import { TerminalWsContext } from '../../src/components/terminal/TerminalWsContext';
import { SdkContextUsageProvider, useSdkContextUsage } from '../../src/components/dashboard/SdkContextUsageProvider';

export const latest = {};
function Observer() {
  Object.assign(latest, useSdkContextUsage());
  return null;
}

export function ProviderProbe({ ws, ...props }) {
  return (
    <TerminalWsContext.Provider value={ws}>
      <SdkContextUsageProvider {...props}><Observer /></SdkContextUsageProvider>
    </TerminalWsContext.Provider>
  );
}
