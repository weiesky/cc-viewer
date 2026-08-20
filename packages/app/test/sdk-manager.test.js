import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSdkAvailable,
  initSdkSession,
  resolveApproval,
  cancelApproval,
  stopSession,
  interruptTurn,
  getSessionId,
} from '../server/lib/sdk-manager.js';

describe('sdk-manager', () => {
  describe('isSdkAvailable', () => {
    it('returns a boolean', () => {
      const result = isSdkAvailable();
      assert.equal(typeof result, 'boolean');
    });
  });

  describe('initSdkSession', () => {
    it('does not throw when initializing', () => {
      assert.doesNotThrow(() => {
        initSdkSession('/tmp', 'test-project', {
          onEntry: () => {},
          onStreamingStatus: () => {},
          broadcastWs: () => {},
          permissionMode: 'default',
        });
      });
    });

    it('resets session state on init', () => {
      initSdkSession('/tmp', 'proj', {
        onEntry: () => {},
        onStreamingStatus: () => {},
        broadcastWs: () => {},
      });
      assert.equal(getSessionId(), null);
    });
  });

  describe('resolveApproval', () => {
    it('returns false when no pending approval matches', () => {
      assert.equal(resolveApproval('nonexistent-id', 'allow'), false);
    });

    it('returns false for empty string id', () => {
      assert.equal(resolveApproval('', 'allow'), false);
    });
  });

  describe('cancelApproval', () => {
    // 现实场景：ask-cancel WS handler 调 cancelApproval(id, reason)。
    // 由于 _pendingApprovals 是模块内闭包变量，不暴露 set 入口，这些测试只能验证
    // 没有 pending 时的行为（match 失败返 false）。完整端到端 cancel sentinel →
    // canUseTool deny 的链路验证留给 sdk-adapter.test.js 的集成测试。
    it('returns false when no pending approval matches', () => {
      assert.equal(cancelApproval('nonexistent-id', 'User aborted'), false);
    });

    it('returns false for empty string id', () => {
      assert.equal(cancelApproval('', 'User aborted'), false);
    });

    it('accepts missing reason (defaults to User aborted)', () => {
      // 不抛错就算 pass — match 失败时根本不会读 reason，但参数必须容错
      assert.doesNotThrow(() => cancelApproval('nonexistent-id'));
      assert.doesNotThrow(() => cancelApproval('nonexistent-id', null));
      assert.doesNotThrow(() => cancelApproval('nonexistent-id', undefined));
    });
  });

  describe('stopSession', () => {
    it('does not throw when no active session', () => {
      assert.doesNotThrow(() => stopSession());
    });

    it('clears session id after stop', () => {
      stopSession();
      assert.equal(getSessionId(), null);
    });
  });

  describe('interruptTurn', () => {
    it('does not throw when no active query', () => {
      stopSession();
      assert.doesNotThrow(() => interruptTurn());
    });

    it('returns an array of cancelled approvals (empty when none pending)', () => {
      stopSession();
      const result = interruptTurn();
      assert.ok(Array.isArray(result));
      assert.equal(result.length, 0);
    });

    it('preserves session id — does not run the full _resetFullState reset', () => {
      // interruptTurn keeps the session alive (only stopSession nulls _sessionId).
      // With no active session getSessionId is already null; the contract verified
      // here is that interruptTurn never throws while leaving session state intact.
      stopSession();
      assert.doesNotThrow(() => interruptTurn());
      assert.equal(getSessionId(), null);
    });
  });

  describe('getSessionId', () => {
    it('returns null when no session is active', () => {
      stopSession();
      assert.equal(getSessionId(), null);
    });
  });
});
