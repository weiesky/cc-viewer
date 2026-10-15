/** SDK workspace actions must carry the same exact instance identity as PTY tabs. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const chat = readFileSync(join(here, '..', 'src', 'components', 'chat', 'ChatView.jsx'), 'utf8');
const server = readFileSync(join(here, '..', '..', '..', 'packages', 'app', 'server', 'server.js'), 'utf8');

const messageTypes = [
  'sdk-user-message',
  'sdk-interrupt',
  'queue-clear',
  'queue-remove',
  'queue-send-now',
];

describe('SDK workspace instance anchors', () => {
  for (const type of messageTypes) {
    it(`ChatView sends instanceKey with ${type}`, () => {
      const sends = chat.split('JSON.stringify({').slice(1).filter((part) => part.startsWith(` type: '${type}'`));
      assert.ok(sends.length > 0, `${type} sender exists`);
      for (const send of sends) {
        const objectLiteral = send.slice(0, send.indexOf('})'));
        assert.ok(objectLiteral.includes('instanceKey: this.props.viewInstance || null'), `${type} carries viewInstance`);
      }
    });

    it(`server forwards instanceKey for ${type}`, () => {
      const branch = server.match(new RegExp(`msg\\.type === '${type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
      assert.ok(branch, `${type} server branch exists`);
      // End the window at the NEXT branch's guard — a fixed-width slice would match the
      // same literal in a neighboring branch and never notice this one dropping the key.
      const rest = server.slice(branch.index);
      const nextBranch = rest.indexOf("} else if (msg.type ===");
      const body = rest.slice(0, nextBranch > 0 ? nextBranch : 2400);
      assert.ok(body.includes('instanceKey: typeof msg.instanceKey'), `${type} anchor forwards msg.instanceKey`);
    });
  }
});
