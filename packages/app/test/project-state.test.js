// Unit tests for server/lib/project-state.js — the mutable "current project
// name" leaf — plus a pinning test for the project-prefs integration arm that
// was previously uncovered (getCurrentProjectName/hasActiveProject reading
// interceptor-driven state).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getProjectName, setProjectName } from '../server/lib/project-state.js';
import { getCurrentProjectName, hasActiveProject } from '../server/lib/project-prefs.js';

test('project-state defaults to empty and round-trips', () => {
  setProjectName('');
  assert.equal(getProjectName(), '');
  setProjectName('my_project');
  assert.equal(getProjectName(), 'my_project');
  setProjectName(null);
  assert.equal(getProjectName(), '');
  setProjectName(42);
  assert.equal(getProjectName(), '');
  setProjectName('');
});

test('getCurrentProjectName prefers the pushed project name over the cwd basename', () => {
  setProjectName('pushed_name');
  try {
    assert.equal(getCurrentProjectName(), 'pushed_name');
  } finally {
    setProjectName('');
  }
});

test('hasActiveProject in workspace mode reflects the pushed name (interceptor arm)', () => {
  const prevMode = process.env.CCV_WORKSPACE_MODE;
  const prevDir = process.env.CCV_PROJECT_DIR;
  process.env.CCV_WORKSPACE_MODE = '1';
  delete process.env.CCV_PROJECT_DIR;
  setProjectName('');
  try {
    assert.equal(hasActiveProject(), false);
    setProjectName('workspace_proj');
    assert.equal(hasActiveProject(), true);
  } finally {
    setProjectName('');
    if (prevMode === undefined) delete process.env.CCV_WORKSPACE_MODE;
    else process.env.CCV_WORKSPACE_MODE = prevMode;
    if (prevDir !== undefined) process.env.CCV_PROJECT_DIR = prevDir;
  }
});
