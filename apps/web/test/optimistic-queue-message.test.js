import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileOptimisticQueueMessages, captureOptimisticQueueTextCounts } from '../src/components/chat/optimisticQueueMessage.js';

const scope = { project: 'project', instanceKey: 'instance', attachedSid: 'session' };
const pending = (id, text = 'follow up', extra = {}) => ({ id, text, ts: 1, ...scope, ...extra });
const user = (content) => ({ role: 'user', content });

describe('optimistic queue message reconciliation', () => {
  it('keeps a dispatching item visible until its actual user text is rendered', () => {
    const items = [pending('q1')];
    assert.deepEqual(reconcileOptimisticQueueMessages(items, { messages: [] }, [{ id: 'q1', status: 'dispatching' }], scope), items);
    assert.deepEqual(reconcileOptimisticQueueMessages(items, { messages: [] }, [], scope), items);
    assert.deepEqual(reconcileOptimisticQueueMessages(items, { messages: [user('follow up')] }, [], scope), []);
  });

  it('recognizes a prompt appended to a tool result or sharing an interrupt block', () => {
    const appended = user([{ type: 'tool_result', tool_use_id: 'tool_1', content: 'done' }, { type: 'text', text: 'follow up' }]);
    assert.deepEqual(reconcileOptimisticQueueMessages([pending('q1')], { messages: [appended] }, [], scope), []);
    const combined = user([{ type: 'text', text: '[Request interrupted by user]\nfollow up' }]);
    assert.deepEqual(reconcileOptimisticQueueMessages([pending('q1')], { messages: [combined] }, [], scope), []);
  });

  it('recognizes display-only queued transcript records without tool results or system text', () => {
    const session = { messages: [user([{ type: 'tool_result', content: 'not the prompt' }])], _ccvQueuedPrompts: [{ content: 'follow up' }] };
    assert.deepEqual(reconcileOptimisticQueueMessages([pending('q1')], session, [], scope), []);
    assert.deepEqual(reconcileOptimisticQueueMessages([pending('q1')], { messages: [{ role: 'system', content: 'follow up' }] }, [], scope).length, 1);
  });

  it('consumes identical texts one at a time and is idempotent', () => {
    const items = [pending('q1', 'same'), pending('q2', 'same')];
    const once = reconcileOptimisticQueueMessages(items, { messages: [user('same')] }, [], scope);
    assert.deepEqual(once.map((item) => item.id), ['q2']);
    assert.deepEqual(reconcileOptimisticQueueMessages(once, { messages: [user('same'), user('same')] }, [], scope), []);
    assert.deepEqual(reconcileOptimisticQueueMessages([], { messages: [user('same')] }, [], scope), []);
  });

  it('does not mistake an identical historical prompt for the new send', () => {
    const history = { messages: [user('same')] };
    const item = pending('q1', 'same', { baselineTextCount: 1 });
    assert.deepEqual(reconcileOptimisticQueueMessages([item], history, [], scope), [item]);
    assert.deepEqual(reconcileOptimisticQueueMessages([item], { messages: [user('same'), user('same')] }, [], scope), []);
  });

  it('returns a restored queued item to the authoritative queue bubble only after dispatching', () => {
    const items = [pending('q1')];
    assert.deepEqual(reconcileOptimisticQueueMessages(items, { messages: [] }, [{ id: 'q1', status: 'queued' }], scope), items);
    const dispatching = [{ ...items[0], dispatchingSeen: true }];
    assert.deepEqual(reconcileOptimisticQueueMessages(dispatching, { messages: [] }, [{ id: 'q1', status: 'queued' }], scope), []);
    assert.deepEqual(reconcileOptimisticQueueMessages(dispatching, { messages: [user('follow up')] }, [{ id: 'q1', status: 'queued' }], scope), []);
  });

  it('acknowledges the exact system envelope but not ordinary system text', () => {
    const content = 'The user sent a new message while you were working:\nfollow up\n\nIMPORTANT: After completing your current task, you MUST address the user\'s message above. Do not ignore it.';
    assert.deepEqual(reconcileOptimisticQueueMessages([pending('q1')], { messages: [{ role: 'system', content }] }, [], scope), []);
    assert.deepEqual(reconcileOptimisticQueueMessages([pending('q1')], { messages: [{ role: 'system', content: 'follow up' }] }, [], scope).length, 1);
  });

  it('skips text acknowledgement while a pinned history view is truncated', () => {
    assert.deepEqual(reconcileOptimisticQueueMessages([pending('q1')], { messages: [user('follow up')] }, [], scope, { allowTextAck: false }).length, 1);
    assert.deepEqual(reconcileOptimisticQueueMessages([pending('q1')], { messages: [user('follow up')] }, [], scope, { allowTextAck: true }), []);
  });

  it('does not scan the session when there are no pending placeholders', () => {
    const session = { get messages() { throw new Error('must not scan'); } };
    const empty = [];
    assert.equal(reconcileOptimisticQueueMessages(empty, session, [], scope), empty);
  });

  it('drops placeholders from another view or attached session', () => {
    const items = [pending('q1'), pending('q2', 'other', { instanceKey: 'other' }), pending('q3', 'old', { attachedSid: 'old' })];
    assert.deepEqual(reconcileOptimisticQueueMessages(items, { messages: [] }, [], scope).map((item) => item.id), ['q1']);
  });

  it('drops a seen-dispatching placeholder once the item leaves the authoritative snapshot', () => {
    const dispatching = [pending('q1', 'follow up', { dispatchingSeen: true })];
    assert.deepEqual(reconcileOptimisticQueueMessages(dispatching, { messages: [] }, [], scope), []);
    assert.deepEqual(reconcileOptimisticQueueMessages(dispatching, { messages: [user('follow up')] }, [], scope), []);
  });

  it('keeps a seen-dispatching placeholder while the item is still dispatching', () => {
    const dispatching = [pending('q1', 'follow up', { dispatchingSeen: true })];
    assert.deepEqual(reconcileOptimisticQueueMessages(dispatching, { messages: [] }, [{ id: 'q1', status: 'dispatching' }], scope), dispatching);
  });

  it('does not drop a fresh placeholder that was never seen dispatching', () => {
    const items = [pending('q1')];
    assert.deepEqual(reconcileOptimisticQueueMessages(items, { messages: [] }, [], scope), items);
  });

  it('acknowledges the prompt in any displayed session, not just the last', () => {
    const sessions = [{ messages: [] }, { messages: [user('follow up')] }];
    assert.deepEqual(reconcileOptimisticQueueMessages([pending('q1')], sessions, [], scope), []);
  });

  it('aggregates identical-text baselines across all displayed sessions', () => {
    const sessions = [{ messages: [user('same')] }, { messages: [user('same')] }];
    const item = pending('q1', 'same', { baselineTextCount: 2 });
    assert.deepEqual(reconcileOptimisticQueueMessages([item], sessions, [], scope), [item]);
    const withThird = [{ messages: [user('same')] }, { messages: [user('same'), user('same')] }];
    assert.deepEqual(reconcileOptimisticQueueMessages([item], withThird, [], scope), []);
  });

  it('captures baselines across all displayed sessions', () => {
    const sessions = [{ messages: [user('a')] }, { messages: [user('a'), user('b')] }];
    assert.deepEqual(captureOptimisticQueueTextCounts(sessions), { a: 2, b: 1 });
  });
});
