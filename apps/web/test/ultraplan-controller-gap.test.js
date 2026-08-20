/**
 * Gap top-up for src/utils/ultraplanController.js
 *
 * test/ultraplan-controller.test.js explicitly skips handleUpload ("DOM-bound, not
 * unit-tested") leaving L22-39 uncovered. handleUpload is the only DOM-touching path,
 * and it's small + deterministic with a fake document.createElement. This file mocks a
 * minimal <input> element on globalThis.document so we drive the full handleUpload flow:
 *   - no file picked → onchange returns early, no setState
 *   - file picked + upload OK → file appended to state via functional setState
 *   - upload rejects → console.error + messageError, no file appended
 *
 * Module imports only ./ultraplanExperts.js (clean) — direct static import works.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { UltraplanController } from '../src/utils/ultraplanController.js';

// ── Fake host (mirrors the sibling test's makeHost) ──────────────────────────────
function makeHost({ uploadOk = true } = {}) {
  const state = { ultraplanFiles: [], customUltraplanExperts: [], ultraplanVariant: 'codeExpert' };
  const messageErrors = [];
  const uploadCalls = [];
  return {
    _state: state,
    _messageErrors: messageErrors,
    _uploadCalls: uploadCalls,
    getState: () => state,
    setState: (updater) => {
      const partial = typeof updater === 'function' ? updater(state) : updater;
      if (partial) Object.assign(state, partial);
    },
    onUpdatePreferences: () => {},
    uploadFile: (file) => {
      uploadCalls.push(file?.name);
      return uploadOk
        ? Promise.resolve(`/tmp/upload/${file?.name || 'x'}`)
        : Promise.reject(new Error('boom'));
    },
    messageError: (m) => { messageErrors.push(m); },
    closeEditor: () => {},
  };
}

// ── Fake document.createElement('input') ─────────────────────────────────────────
// The input we return lets the test seed `files`, then `.click()` synchronously
// invokes the onchange handler the controller assigned (mimicking a user file pick).
let createdInputs = [];
function installDocument() {
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'input');
      const input = {
        type: '',
        onchange: null,
        _files: [],
        click() {
          // Fire the handler the controller wired up, passing a synthetic event.
          if (typeof this.onchange === 'function') {
            return this.onchange({ target: { files: this._files } });
          }
        },
      };
      createdInputs.push(input);
      return input;
    },
  };
}

const tick = () => new Promise(r => setImmediate(r));

// Silence + capture console.error from the upload-failure branch.
let origError;
let errorLogs;
before(() => {
  installDocument();
  origError = console.error;
  errorLogs = [];
  console.error = (...args) => { errorLogs.push(args); };
});
after(() => {
  delete globalThis.document;
  console.error = origError;
});
beforeEach(() => { createdInputs = []; errorLogs.length = 0; });

describe('UltraplanController.handleUpload', () => {
  it('creates a file input of type "file" and clicks it', () => {
    const host = makeHost();
    const c = new UltraplanController(host);
    c.handleUpload();
    assert.equal(createdInputs.length, 1);
    assert.equal(createdInputs[0].type, 'file');
    assert.equal(typeof createdInputs[0].onchange, 'function');
  });

  it('no file selected → onchange returns early, no upload, no state change', async () => {
    const host = makeHost();
    const c = new UltraplanController(host);
    c.handleUpload();
    createdInputs[0]._files = []; // user cancelled the picker
    createdInputs[0].click();
    await tick();
    assert.equal(host._uploadCalls.length, 0);
    assert.equal(host._state.ultraplanFiles.length, 0);
  });

  it('file picked + upload OK → appends { name, path } to ultraplanFiles', async () => {
    const host = makeHost();
    const c = new UltraplanController(host);
    c.handleUpload();
    createdInputs[0]._files = [{ name: 'diagram.png' }];
    createdInputs[0].click();
    await tick();
    assert.deepEqual(host._uploadCalls, ['diagram.png']);
    assert.equal(host._state.ultraplanFiles.length, 1);
    assert.deepEqual(host._state.ultraplanFiles[0], {
      name: 'diagram.png',
      path: '/tmp/upload/diagram.png',
    });
  });

  it('upload rejects → console.error logged + messageError(err.message), no file appended', async () => {
    const host = makeHost({ uploadOk: false });
    const c = new UltraplanController(host);
    c.handleUpload();
    createdInputs[0]._files = [{ name: 'bad.png' }];
    createdInputs[0].click();
    await tick();
    assert.equal(host._state.ultraplanFiles.length, 0);
    assert.deepEqual(host._messageErrors, ['boom']);
    assert.equal(errorLogs.length, 1);
    assert.match(String(errorLogs[0][0]), /Ultraplan upload failed/);
  });
});
