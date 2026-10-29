import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = (path) => readFileSync(join(here, '..', 'src', path), 'utf-8');
const provider = src('components/dashboard/SdkContextUsageProvider.jsx');
const desktop = src('components/dashboard/LiveTagPopover.jsx');
const mobile = src('Mobile.jsx');
const popover = src('components/dashboard/CachePopoverContent.jsx');
const memory = src('components/common/MemoryDetailModal.jsx');
const app = src('App.jsx');
const chatInput = src('components/chat/ChatInputBar.jsx');

describe('SDK context blood-bar integration contracts', () => {
  it('shares one provider and keeps SDK composition out of PTY/local/history bars', () => {
    assert.match(app, /enabled=\{!this\._isLocalLog && this\.state\.sdkMode && !this\.state\.attachedSid\}/);
    assert.match(mobile, /enabled=\{!mobileIsLocalLog && this\.state\.sdkMode && !this\.state\.attachedSid\}/);
    assert.equal((provider.match(/addMessageHandler\(/g) || []).length, 1);
    assert.equal((provider.match(/fetch\(/g) || []).length, 1);
    assert.match(provider, /const scopeKey = `\$\{active \? '1' : '0'\}/);
    assert.match(desktop, /mergeSdkContextBar/);
    assert.match(mobile, /mergeSdkContextBar/);
    assert.match(popover, /\{!merged\.sdkActive && \(/);
    assert.match(popover, /value=\{calibrationModel\}/);
  });

  it('keeps the input blood bar minimal and puts composition details in its popover', () => {
    assert.doesNotMatch(desktop, /SdkContextComposition/);
    assert.doesNotMatch(mobile, /SdkContextComposition/);
    assert.match(popover, /variant="compact"/);
    assert.match(popover, /buildApiUsage/);
    assert.doesNotMatch(popover, /gridToRows/);
  });

  it('puts token costs above descriptions and scopes memory costs to its directory', () => {
    assert.match(popover, /skillUsage\.tokensByName\.get\(name\)/);
    assert.match(popover, /memory\?\.dir/);
    assert.match(popover, /onOpenMemoryDetail\?\.\(r\.open, memory\?\.dir\)/);
    assert.match(popover, /useMemoryLinkTip/);
    assert.match(memory, /linkMode === 'memory'.*&& sdk\.enabled/);
    assert.match(memory, /memoryTokensForLink\(buildMemoryUsageIndex\(sdk\.detail\.usage, memoryDir\), name\)/);
    for (const path of ['components/dashboard/SdkContextComposition.module.css', 'components/dashboard/SdkContextPalette.module.css', 'components/dashboard/CachePopoverContent.module.css']) {
      assert.doesNotMatch(src(path), /!important/);
    }
  });

  it('keeps the ctxBarSlot portal host mounted while the SDK scratch terminal is open', () => {
    // In SDK mode terminalVisible mirrors scratchOpen while the composer stays mounted
    // (early return is gated on `terminalVisible && !sdkMode`). The blood-bar portal host
    // must use the same exemption: a raw `!terminalVisible` gate unmounts the slot on
    // scratch open, so AppHeader's createPortal(LiveTagPopover) loses its target.
    assert.equal((chatInput.match(/styles\.ctxBarSlot/g) || []).length, 1,
      'exactly one ctxBarSlot portal host in ChatInputBar');
    const gate = chatInput.match(
      /\{!\(isMobile && !isPad\)\s*&&\s*([\s\S]*?)\s*&&\s*setContextBarSlot\s*&&\s*\(\s*<div className=\{styles\.ctxBarSlot\}[\s\S]*?ref=\{setContextBarSlot\}/,
    );
    assert.ok(gate, 'ChatInputBar renders the ctxBarSlot host for AppHeader');
    assert.match(gate[1], /!\(terminalVisible && !sdkMode\)|!terminalVisible\s*\|\|\s*sdkMode/,
      'slot gate must exempt sdkMode; PTY terminal-open still hides the slot');
    assert.match(chatInput, /if \(terminalVisible && !sdkMode\) \{/,
      'composer early return keeps the SDK composer mounted');
  });
});
