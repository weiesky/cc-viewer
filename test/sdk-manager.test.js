import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSdkAvailable,
  initSdkSession,
  resolveApproval,
  stopSession,
  getSessionId,
} from '../lib/sdk-manager.js';

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

  describe('stopSession', () => {
    it('does not throw when no active session', () => {
      assert.doesNotThrow(() => stopSession());
    });

    it('clears session id after stop', () => {
      stopSession();
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
