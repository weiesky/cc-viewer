import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(here, '..');
const CHAT_VIEW = join(WEB_ROOT, 'src/components/chat/ChatView.jsx');
const BUNDLE_DIR = join(WEB_ROOT, 'node_modules', '.cache', 'ccv-response-thinking-chat-test');
const BUNDLE = join(BUNDLE_DIR, `ChatView-${process.pid}.mjs`);
const thinking = (value, signature) => ({ type: 'thinking', thinking: value, ...(signature && { signature }) });
const text = (value) => ({ type: 'text', text: value });
const tool = (id, name = 'Read') => ({ type: 'tool_use', id, name, input: {} });
const mainEntry = (timestamp, content, extra = {}) => ({
  timestamp,
  url: 'https://example.invalid/v1/messages',
  mainAgent: true,
  body: { model: 'k3.1-pro', messages: [] },
  response: { status: 200, body: { content } },
  _seqEpoch: 'v2:sid',
  ...extra,
});
const assistant = (content, generatedTs) => {
  const sequence = Number(generatedTs?.slice(1)) || 0;
  return { role: 'assistant', content, _timestamp: `t${sequence + 1}`, _generatedTs: generatedTs };
};
const sessionWith = (messages, response, extra = {}) => ({
  messages,
  response,
  entryTimestamp: 't-next',
  _seqEpoch: 'v2:sid',
  ...extra,
});

function collectStubExportNames(root) {
  const names = new Set();
  const visit = (dir) => {
    for (const entry of readdirSync(dir)) {
      const file = join(dir, entry);
      if (statSync(file).isDirectory()) visit(file);
      else if (/\.[jt]sx?$/.test(entry)) {
        const src = readFileSync(file, 'utf8');
        const add = (body) => body.split(',').forEach((part) => {
          const name = part.trim().split(/\s+as\s+/).pop().trim();
          if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
        });
        for (const match of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]/gs)) add(match[1]);
        for (const match of src.matchAll(/export\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]/gs)) add(match[1]);
      }
    }
  };
  visit(join(root, 'src'));
  return [...names];
}

async function buildChatView() {
  const appRequire = createRequire(join(WEB_ROOT, 'package.json'));
  const esbuildPath = createRequire(appRequire.resolve('vite')).resolve('esbuild');
  const esbuild = await import(pathToFileURL(esbuildPath).href);
  const names = new Set(collectStubExportNames(WEB_ROOT));
  names.add('tags');
  const stub = [
    'const h = () => null;',
    'const S = new Proxy(function(){}, { apply:()=>S, construct:()=>({}), get:()=>S });',
    'export default S;',
    ...[...names].map((name) => `export const ${name} = S;`),
  ].join('\n');
  const plugin = {
    name: 'ccv-response-thinking-stubs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const path = args.path;
        if (/\.(css|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|mp3|wav|ogg)$/.test(path.split('?')[0])) return { path, namespace: 'asset' };
        if (path.startsWith('.') || path.startsWith('/') || path.startsWith('node:')) return null;
        if (path === 'react' || path === 'react-dom' || path === 'react-dom/client' || path.startsWith('react/')) return null;
        return { path, namespace: 'stub' };
      });
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: stub, loader: 'js' }));
      build.onLoad({ filter: /.*/, namespace: 'asset' }, (args) => ({
        contents: /\.css$/.test(args.path) ? 'export default new Proxy({}, { get: () => "" });' : 'export default "";',
        loader: 'js',
      }));
    },
  };
  const result = await esbuild.build({
    entryPoints: [CHAT_VIEW], bundle: true, format: 'esm', platform: 'browser', write: false,
    jsx: 'automatic', loader: { '.jsx': 'jsx', '.js': 'jsx' }, plugins: [plugin], logLevel: 'silent',
  });
  mkdirSync(BUNDLE_DIR, { recursive: true });
  writeFileSync(BUNDLE, result.outputFiles[0].contents);
}

let ChatView;

function makeView({ sessions, requests, thinkingRequests, minimalChat = false, onlyCurrentSession = false, sessionUpperBoundTs = null }) {
  const view = new ChatView({
    mainAgentSessions: sessions,
    requests,
    thinkingRequests,
    minimalChat,
    onlyCurrentSession,
    sessionUpperBoundTs,
    cliMode: false,
    sdkMode: true,
    preferences: {},
  });
  // The behavior under test is buildAllItems, not browser/network lifecycle.
  view.setState = (update, callback) => {
    const patch = typeof update === 'function' ? update(view.state, view.props) : update;
    view.state = { ...view.state, ...patch };
    callback?.();
  };
  return view;
}

function collectThinking(items) {
  const out = [];
  const visit = (node, assistantRow = false) => {
    if (!node?.props) return;
    const isAssistantRow = node.props.role === 'assistant';
    if (isAssistantRow) {
      const members = node.props.runMembers;
      if (members && !assistantRow) for (const member of members) visit(member, true);
      else for (const block of node.props.content || []) if (block?.type === 'thinking') out.push(block.thinking);
      return;
    }
    const children = node.props.children;
    for (const child of Array.isArray(children) ? children : [children]) visit(child, assistantRow);
  };
  for (const item of items || []) visit(item);
  return out;
}

function lrContent(view) {
  let content = [];
  const visit = (node) => {
    if (!node?.props) return;
    if (node.key === 'resp-asst') content = node.props.content || [];
    const children = node.props.children;
    for (const child of Array.isArray(children) ? children : [children]) visit(child);
  };
  visit(view._lastResponseItems);
  return content;
}

describe('ChatView response thinking behavior (real buildAllItems)', () => {
  before(async () => {
    globalThis.window = globalThis;
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true });
    globalThis.location = { search: '', pathname: '/', href: 'http://localhost/', hash: '' };
    globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    await buildChatView();
    ChatView = (await import(pathToFileURL(BUNDLE).href)).default;
  });

  it('restores multiple cold turns into their own assistant messages', () => {
    const messages = [assistant([text('first')], 't1'), assistant([text('second')], 't2')];
    const responseContent = [thinking('second thought', 's2'), text('second')];
    const session = sessionWith(messages, { body: { content: responseContent } });
    const requests = [mainEntry('t1', [thinking('first thought', 's1'), text('first')]), mainEntry('t2', responseContent)];
    const view = makeView({ sessions: [session], requests });
    const items = view.buildAllItems();
    assert.deepEqual(collectThinking(items), ['first thought', 'second thought']);
    assert.deepEqual(lrContent(view).map((block) => block.type), ['text']);
    assert.equal(messages[0].content.some((block) => block.type === 'thinking'), false);
    assert.equal(messages[1].content.some((block) => block.type === 'thinking'), false);
  });

  it('refreshes FULL HIT rows for late responses and removes stale thinking when replaced', () => {
    const messages = [assistant([text('answer')], 't1')];
    const responseContent = [thinking('latest own thought'), text('latest')];
    const session = sessionWith(messages, { body: { content: responseContent } });
    const view = makeView({ sessions: [session], requests: [mainEntry('t2', responseContent)] });
    let items = view.buildAllItems();
    assert.deepEqual(collectThinking(items), []);
    assert.deepEqual(collectThinking([view._lastResponseItems]), ['latest own thought']);
    const cachedItems = view._sessionItemCache[0].items;

    const lateContent = [thinking('late thought', 'late-signature'), text('answer')];
    view.props = { ...view.props, requests: [mainEntry('t1', lateContent), ...view.props.requests] };
    items = view.buildAllItems();
    assert.deepEqual(collectThinking(items), ['late thought']);
    assert.deepEqual(lrContent(view).map((block) => block.type), ['thinking', 'text']);
    assert.equal(view._sessionItemCache[0].items !== cachedItems, true);

    const stable = view.buildAllItems();
    assert.equal(stable[0], items[0], 'unchanged restored rows retain element identity');
    view.props = { ...view.props, requests: [mainEntry('t1', [text('answer')]), ...view.props.requests.slice(1)] };
    items = view.buildAllItems();
    assert.deepEqual(collectThinking(items), []);
    assert.deepEqual(collectThinking([view._lastResponseItems]), ['latest own thought']);
  });

  it('keeps the incremental path when a later turn appends to a cached session', () => {
    const messages = [assistant([text('first')], 't1')];
    const secondResponse = [thinking('second thought'), text('second')];
    const session = sessionWith(messages, { body: { content: secondResponse } });
    const view = makeView({
      sessions: [session],
      requests: [mainEntry('t1', [thinking('first thought'), text('first')]), mainEntry('t2', secondResponse)],
    });
    const firstItems = view.buildAllItems();
    assert.deepEqual(collectThinking(firstItems), ['first thought']);
    const oldElement = firstItems.find((item) => item.props.role === 'assistant');
    messages.push(assistant([text('second')], 't2'));
    const nextItems = view.buildAllItems();
    assert.deepEqual(collectThinking(nextItems), ['first thought', 'second thought']);
    assert.equal(nextItems.find((item) => item.props.role === 'assistant'), oldElement);
    assert.equal(lrContent(view).some((block) => block.type === 'thinking'), false);
  });

  it('rebuilds same-length message content growth and keeps restored content ordered', () => {
    const message = assistant([tool('tool-1')], 't1');
    const responseContent = [thinking('reason'), tool('tool-1')];
    const session = sessionWith([message], { body: { content: [] } });
    const view = makeView({ sessions: [session], requests: [mainEntry('t1', responseContent)] });
    let items = view.buildAllItems();
    assert.deepEqual(items.find((item) => item.props.role === 'assistant').props.content.map((block) => block.type), ['thinking', 'tool_use']);
    message.content = [thinking('reason'), tool('tool-1')];
    items = view.buildAllItems();
    assert.deepEqual(items.find((item) => item.props.role === 'assistant').props.content.map((block) => block.type), ['thinking', 'tool_use']);
  });

  it('does not duplicate a pending interaction when restoring its thinking', () => {
    const ask = tool('ask-1', 'AskUserQuestion');
    const message = assistant([ask], 't1');
    const responseContent = [thinking('need an answer'), ask];
    const session = sessionWith([message], { body: { content: responseContent } });
    const view = makeView({ sessions: [session], requests: [mainEntry('t1', responseContent)] });
    const items = view.buildAllItems();
    const assistantRows = items.filter((item) => item.props.role === 'assistant');
    assert.equal(assistantRows.length, 1);
    assert.equal(assistantRows[0].props.lastPendingAskId, 'ask-1');
    assert.deepEqual(lrContent(view).map((block) => block.type), []);
    assert.equal(view._lastResponseItems, null, 'only a duplicated interactive block remains after LR filtering');
  });

  it('restores a cold-loaded tail from its next carrier and refreshes source-only updates', () => {
    const message = assistant([text('cold answer')], null);
    message._timestamp = 't6';
    const producer = mainEntry('t5', [thinking('cold thought'), text('cold answer')]);
    const carrier = mainEntry('t6', [thinking('next'), text('next')], {
      body: { messages: [{ role: 'user', content: 'next' }, message] },
      _prevMsgCount: 0,
    });
    const session = sessionWith([message], carrier.response);
    const view = makeView({ sessions: [session], requests: [], thinkingRequests: [producer, carrier] });
    assert.deepEqual(collectThinking(view.buildAllItems()), ['cold thought']);
    view.props = { ...view.props, thinkingRequests: [producer, { ...carrier, response: { body: { content: [text('next')] } } }] };
    assert.deepEqual(collectThinking(view.buildAllItems()), ['cold thought']);
  });

  it('keeps thinking inside minimal-chat run members and isolates pinned sessions', () => {
    const messages = [assistant([tool('tool-1')], 't1'), assistant([tool('tool-2')], 't2')];
    const firstResponse = [thinking('first tool thought'), tool('tool-1')];
    const secondResponse = [thinking('second tool thought'), tool('tool-2')];
    const first = sessionWith(messages, { body: { content: secondResponse } });
    const view = makeView({ sessions: [first], requests: [mainEntry('t1', firstResponse), mainEntry('t2', secondResponse)], minimalChat: true });
    const items = view.buildAllItems();
    assert.equal(items.filter((item) => item.props.role === 'assistant').length, 1);
    assert.deepEqual(items.filter((item) => item.props.role === 'assistant').map((item) => ({
      content: item.props.content,
      members: item.props.runMembers?.map((member) => member.props.content),
    })), [
      {
        content: [thinking('second tool thought'), tool('tool-2')],
        members: [
          [thinking('first tool thought'), tool('tool-1')],
          [thinking('second tool thought'), tool('tool-2')],
        ],
      },
    ]);
    assert.deepEqual(collectThinking(items), ['first tool thought', 'second tool thought']);

    const pinnedMessage = assistant([text('other')], 'x1');
    const pinned = sessionWith([pinnedMessage], null, { _seqEpoch: 'v2:other' });
    const pinnedView = makeView({
      sessions: [pinned],
      requests: view.props.requests,
      minimalChat: true,
      onlyCurrentSession: true,
      sessionUpperBoundTs: first.messages[0]._timestamp,
    });
    const pinnedItems = pinnedView.buildAllItems();
    assert.deepEqual(collectThinking(pinnedItems), []);
    assert.equal(pinnedMessage.content.length, 1);
  });
});
