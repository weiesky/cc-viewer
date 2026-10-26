import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlanAutoApproveTarget, sdkPlanMatchesView } from '../src/utils/planAutoApprove.js';

describe('resolvePlanAutoApproveTarget', () => {
  it('selects only the SDK pending plan in SDK mode', () => {
    assert.deepEqual(resolvePlanAutoApproveTarget({
      sdkMode: true,
      pendingPlanApproval: { id: 'sdk-plan' },
      pendingPtyPlan: { id: 'stale-pty-plan' },
      viewProject: 'project-a',
    }), { id: 'sdk-plan', channel: 'sdk' });
  });

  it('selects only the PTY pending plan outside SDK mode', () => {
    assert.deepEqual(resolvePlanAutoApproveTarget({
      sdkMode: false,
      pendingPlanApproval: { id: 'stale-sdk-plan' },
      pendingPtyPlan: { id: 'pty-plan' },
    }), { id: 'pty-plan', channel: 'pty' });
  });

  it('does not fall back to the other transport when its plan is absent', () => {
    assert.equal(resolvePlanAutoApproveTarget({ sdkMode: true, pendingPtyPlan: { id: 'pty-plan' } }), null);
    assert.equal(resolvePlanAutoApproveTarget({ sdkMode: false, pendingPlanApproval: { id: 'sdk-plan' } }), null);
  });

  it('rejects pending entries without an approval id', () => {
    assert.equal(resolvePlanAutoApproveTarget({ sdkMode: true, pendingPlanApproval: {} }), null);
    assert.equal(resolvePlanAutoApproveTarget({ sdkMode: false, pendingPtyPlan: {} }), null);
  });

  it('does not auto-approve a plan after its workspace or instance leaves the view', () => {
    const pendingPlanApproval = { id: 'plan-a', cwd: '/work/project-a', instanceKey: 'instance-a' };
    assert.equal(resolvePlanAutoApproveTarget({
      sdkMode: true, pendingPlanApproval, viewProject: 'project-b', viewInstance: 'instance-a',
    }), null);
    assert.equal(resolvePlanAutoApproveTarget({
      sdkMode: true, pendingPlanApproval, viewProject: 'project-a', viewInstance: 'instance-b',
    }), null);
    assert.deepEqual(resolvePlanAutoApproveTarget({
      sdkMode: true, pendingPlanApproval, viewProject: 'project-a', viewInstance: 'instance-a',
    }), { id: 'plan-a', channel: 'sdk' });
  });

  it('never auto-approves while the SDK view identity is unresolved', () => {
    assert.equal(resolvePlanAutoApproveTarget({
      sdkMode: true,
      pendingPlanApproval: { id: 'background-plan', cwd: '/work/background', instanceKey: 'background-instance' },
      viewProject: '',
      viewInstance: null,
    }), null);
    assert.equal(resolvePlanAutoApproveTarget({
      sdkMode: true,
      pendingPlanApproval: { id: 'instance-plan', cwd: '/work/project-a', instanceKey: 'instance-a' },
      viewProject: '',
      viewInstance: 'instance-a',
    }), null);
  });

  it('uses the existing tolerant SDK frame matching semantics', () => {
    assert.equal(sdkPlanMatchesView({ cwd: '/work/project-a' }, '', null), true);
    assert.equal(sdkPlanMatchesView({ cwd: '/work/project-a' }, 'project-a', null), true);
    assert.equal(sdkPlanMatchesView({ cwd: '/work/project-a' }, 'project-b', null), false);
    assert.equal(sdkPlanMatchesView({ instanceKey: 'instance-a' }, '', 'instance-b'), false);
  });
});
