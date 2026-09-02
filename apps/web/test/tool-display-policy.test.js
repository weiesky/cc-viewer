/**
 * Guards the shared full-display tool set (apps/web/src/utils/toolDisplayPolicy.js)
 * that ChatMessage's two content renderers AND the minimal-chat run merge share.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FULL_DISPLAY_TOOLS, isFullDisplayTool } from '../src/utils/toolDisplayPolicy.js';

describe('toolDisplayPolicy', () => {
  it('is exactly the nine tools that stay expanded in simplified mode', () => {
    assert.deepEqual(
      [...FULL_DISPLAY_TOOLS].sort(),
      ['Agent', 'AskUserQuestion', 'Edit', 'EnterPlanMode', 'ExitPlanMode', 'SendMessage', 'TaskCreate', 'Workflow', 'Write'],
    );
  });

  it('isFullDisplayTool answers by exact name', () => {
    assert.equal(isFullDisplayTool('Edit'), true);
    assert.equal(isFullDisplayTool('AskUserQuestion'), true);
    assert.equal(isFullDisplayTool('Bash'), false);
    assert.equal(isFullDisplayTool('Read'), false);
    assert.equal(isFullDisplayTool('TodoWrite'), false);
    assert.equal(isFullDisplayTool('mcp__x__y'), false);
    assert.equal(isFullDisplayTool(undefined), false);
  });
});
