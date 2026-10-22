// Host runtime for plugin panels: installs window.CCV with shared deps and the
// registerPanel handshake. Imported once at the AppBase module top so it is live before
// any panel bundle executes (panel bundles are classic scripts that synchronously call
// window.CCV.registerPanel during their own execution).
//
// Why shared deps are mandatory, not an optimization: a second React copy breaks hooks
// ("Invalid hook call" — hooks read React's module-internal dispatcher), and a second
// antd copy disconnects the panel from the host's ConfigProvider theme. Panel bundles
// MUST resolve react/react-dom/antd through window.CCV.deps (the panel build template
// rewrites those imports at build time).
import React from 'react';
import ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import * as ReactJsxDevRuntime from 'react/jsx-dev-runtime';
import * as antd from 'antd';
import { reportSwallowed } from '../../utils/errorReport';

const API_VERSION = 1;
const MAX_REGISTRY = 200;

function isValidComponent(component) {
  return typeof component === 'function' || (component && typeof component === 'object' && component.$$typeof);
}

export function installPanelRuntime(win = window, doc = document) {
  if (win.CCV && win.CCV.apiVersion === API_VERSION) {
    return win.CCV;
  }
  // pending: loadId -> { name, component, src }. registerPanel is a one-shot handshake
  // (consumed on read), not a registry — PanelHost owns the component instance per open.
  const pending = new Map();
  // Tombstones for loadIds the loader has cancelled (timeout/unload/error): a script that
  // executes after cancellation must not resurrect its registration.
  const dropped = new Set();

  const ccv = {
    apiVersion: API_VERSION,
    hostVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev',
    deps: Object.freeze({
      React,
      ReactDOM,
      ReactDOMClient,
      ReactJsxRuntime,
      ReactJsxDevRuntime,
      antd,
    }),
    registerPanel(name, component) {
      try {
        // currentScript is guaranteed during a classic script's synchronous top-level execution; null in async/event callbacks
        const script = doc.currentScript;
        if (!script) {
          reportSwallowed('plugin-panel.register', new Error(`registerPanel("${name}") called outside script execution (currentScript is null) — bundles must register synchronously`));
          return false;
        }
        const loadId = script.getAttribute('data-ccv-load');
        if (!loadId) {
          reportSwallowed('plugin-panel.register', new Error(`registerPanel("${name}") from a script without data-ccv-load — only the panel loader may inject panel bundles`));
          return false;
        }
        if (dropped.has(loadId)) {
          reportSwallowed('plugin-panel.register', new Error(`registerPanel("${name}") for a cancelled load ${loadId} — ignored`));
          return false;
        }
        if (typeof name !== 'string' || !name) {
          reportSwallowed('plugin-panel.register', new Error('registerPanel requires a non-empty name'));
          return false;
        }
        if (!isValidComponent(component)) {
          reportSwallowed('plugin-panel.register', new Error(`registerPanel("${name}") received a non-component value`));
          return false;
        }
        if (pending.size >= MAX_REGISTRY) {
          pending.delete(pending.keys().next().value);
        }
        pending.set(loadId, { name, component, src: script.src || '' });
        return true;
      } catch (err) {
        reportSwallowed('plugin-panel.register', err);
        return false;
      }
    },
    // Loader-only: take and remove one load's registration (returns null when absent)
    _consumeRegistration(loadId) {
      const reg = pending.get(loadId) || null;
      if (reg) pending.delete(loadId);
      return reg;
    },
    _dropRegistration(loadId) {
      pending.delete(loadId);
      if (!loadId) return;
      dropped.add(loadId);
      if (dropped.size > MAX_REGISTRY) dropped.delete(dropped.values().next().value);
    },
  };
  Object.freeze(ccv.deps);
  win.CCV = ccv;
  return ccv;
}

// Auto-install at module top (App/Mobile share AppBase; both trees install first; skipped under node:test with no window)
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  installPanelRuntime();
}
