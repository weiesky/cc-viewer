import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..');
let TerminalWsProvider;
let sockets;

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.frames = [];
    sockets.push(this);
  }
  send(frame) { this.frames.push(JSON.parse(frame)); }
  close() { this.readyState = 3; }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen(); }
}

before(async () => {
  globalThis.window = { location: { protocol: 'http:', host: 'localhost', search: '', pathname: '/', hash: '' } };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const appRequire = createRequire(join(webRoot, 'package.json'));
  const esbuildPath = createRequire(appRequire.resolve('vite')).resolve('esbuild');
  const esbuild = await import(pathToFileURL(esbuildPath).href);
  const result = await esbuild.build({
    entryPoints: [join(webRoot, 'src/components/terminal/TerminalWsContext.jsx')],
    bundle: true, format: 'esm', platform: 'browser', write: false,
    jsx: 'automatic', loader: { '.jsx': 'jsx', '.js': 'jsx' },
  });
  TerminalWsProvider = (await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`)).TerminalWsProvider;
});

function provider(props) {
  const view = new TerminalWsProvider({ open: true, ...props });
  view._notifyState = () => {};
  return view;
}

describe('TerminalWsProvider view attachment', () => {
  it('attaches the current view once when props change while CONNECTING', () => {
    sockets = [];
    globalThis.WebSocket = FakeWebSocket;
    const view = provider({ viewedProject: null, viewedInstance: null });
    view.componentDidMount();
    view.props = { open: true, viewedProject: 'project-b', viewedInstance: 'instance-b' };
    view.componentDidUpdate({ open: true, viewedProject: null, viewedInstance: null });
    assert.equal(sockets[0].frames.length, 0, 'CONNECTING cannot send yet');
    sockets[0].open();
    assert.deepEqual(sockets[0].frames, [{ type: 'attach', project: 'project-b', instanceKey: 'instance-b' }]);
    assert.equal(view.attach('project-b', 'instance-b'), false, 'the repaired identity is deduped');
    view.disconnect();
  });

  it('does not repeat the attach already performed by the URL handshake', () => {
    sockets = [];
    globalThis.WebSocket = FakeWebSocket;
    const view = provider({ viewedProject: 'project-a', viewedInstance: 'instance-a' });
    view.componentDidMount();
    sockets[0].open();
    assert.deepEqual(sockets[0].frames, []);
    assert.equal(view._attachedProject, 'project-a');
    assert.equal(view._attachedInstance, 'instance-a');
    view.disconnect();
  });
});
