import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const output = await mkdtemp(join(tmpdir(), 'quickmap-map-codex-test-'));
const script = fileURLToPath(new URL('./fixtures/mock-codex-app-server.mjs', import.meta.url));
await build({ entryPoints: ['electron/map-codex.ts'], outfile: join(output, 'map-codex.cjs'),
  platform: 'node', format: 'cjs', target: 'node22', bundle: true });
const require = createRequire(import.meta.url);
const { MapCodexSession, SAFE_CODEX_ARGS, validateMapAnswer, streamedAnswerPrefix } = require(join(output, 'map-codex.cjs'));
after(() => rm(output, { recursive: true, force: true }));

async function eventOf(events, type, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const found = events.find((event) => event.type === type);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`No ${type} event; received ${JSON.stringify(events)}`);
}

async function session(mode, turnTimeoutMs = 2000) {
  const dataDir = await mkdtemp(join(tmpdir(), 'quickmap-map-chat-'));
  const events = [];
  const previous = process.env.QUICKMAP_TEST_APP_SERVER_MODE;
  process.env.QUICKMAP_TEST_APP_SERVER_MODE = mode;
  const bridge = new MapCodexSession({ dataDir, command: process.execPath, args: [script],
    onEvent: (event) => events.push(event), turnTimeoutMs });
  return { bridge, events, dataDir, cleanup: async () => {
    await bridge.close();
    if (previous === undefined) delete process.env.QUICKMAP_TEST_APP_SERVER_MODE;
    else process.env.QUICKMAP_TEST_APP_SERVER_MODE = previous;
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } };
}

test('structured answer streams only its natural-language field and preserves follow-up thread', async () => {
  const { bridge, events, cleanup } = await session('happy');
  try {
    const first = bridge.ask('为什么重要？');
    const completed = await eventOf(events, 'completed');
    assert.equal(completed.requestId, first.requestId);
    assert.equal(completed.answer, '海峡是波斯湾的出口。');
    assert.deepEqual(completed.stepIds, ['hormuz-1']);
    assert.ok(events.some((event) => event.type === 'delta'));
    assert.ok(events.filter((event) => event.type === 'delta').every((event) => !event.text.includes('{')));
    events.length = 0;
    bridge.ask('那管道呢？');
    assert.equal((await eventOf(events, 'completed')).answer, '管道只能分担部分原油。');
  } finally { await cleanup(); }
});

test('auth and unexpected approval requests fail visibly without granting permission', async () => {
  for (const [mode, expected] of [['auth', 'auth_required'], ['approval', 'approval_required']]) {
    const { bridge, events, cleanup } = await session(mode);
    try {
      bridge.ask('讲解');
      assert.equal((await eventOf(events, 'error')).code, expected);
    } finally { await cleanup(); }
  }
});

test('unknown story IDs are rejected and late output after cancel is ignored', async () => {
  const bad = await session('bad-id');
  try {
    bad.bridge.ask('讲解');
    assert.equal((await eventOf(bad.events, 'error')).code, 'invalid_response');
  } finally { await bad.cleanup(); }
  const cancelled = await session('cancel');
  try {
    const { requestId } = cancelled.bridge.ask('讲解');
    await eventOf(cancelled.events, 'started');
    await cancelled.bridge.cancel(requestId);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual(cancelled.events.map((event) => event.type), ['started', 'cancelled']);
  } finally { await cancelled.cleanup(); }
});

test('missing CLI, timeout, and app-server exit have distinct error states', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'quickmap-missing-codex-'));
  const missingEvents = [];
  const missing = new MapCodexSession({ dataDir, command: join(dataDir, 'missing-codex.exe'),
    onEvent: (event) => missingEvents.push(event), turnTimeoutMs: 1000 });
  try {
    missing.ask('讲解');
    assert.equal((await eventOf(missingEvents, 'error')).code, 'codex_missing');
  } finally {
    await missing.close();
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
  for (const [mode, expected] of [['hang', 'timeout'], ['disconnect', 'disconnected']]) {
    const { bridge, events, cleanup } = await session(mode, mode === 'hang' ? 300 : 5000);
    try {
      bridge.ask('讲解');
      assert.equal((await eventOf(events, 'error', 7000)).code, expected);
    } finally { await cleanup(); }
  }
});

test('configured MCP tools are disabled and any tool call fails closed', async () => {
  for (const flag of ['apps', 'plugins', 'hooks', 'shell_tool', 'multi_agent']) {
    assert.ok(SAFE_CODEX_ARGS.includes(flag));
  }
  assert.ok(SAFE_CODEX_ARGS.includes('web_search="disabled"'));
  for (const mode of ['isolation-fail', 'tool-call']) {
    const { bridge, events, cleanup } = await session(mode);
    try {
      bridge.ask('讲解');
      assert.equal((await eventOf(events, 'error')).code, 'tool_isolation_failed');
      assert.equal(events.some((event) => event.type === 'completed'), false);
    } finally { await cleanup(); }
  }
});

test('unresumable saved conversation explicitly clears renderer history', async () => {
  const { bridge, events, dataDir, cleanup } = await session('stale');
  try {
    await writeFile(join(dataDir, 'thread.json'), JSON.stringify({ storyVersion: 1, threadId: 'thr_stale' }));
    bridge.ask('讲解');
    const reset = await eventOf(events, 'conversation_reset');
    assert.match(reset.message, /原地图问答会话/);
    await eventOf(events, 'completed');
  } finally { await cleanup(); }
});

test('unsafe streamed command or URL never reaches renderer as a complete answer', async () => {
  for (const mode of ['bad-text', 'bad-url']) {
    const { bridge, events, cleanup } = await session(mode);
    try {
      bridge.ask('讲解');
      assert.equal((await eventOf(events, 'error')).code, 'invalid_response');
      assert.equal(events.some((event) => event.type === 'completed'), false);
      assert.ok(events.filter((event) => event.type === 'delta').every((event) =>
        !event.text.includes('{') && !event.text.includes('file:///')));
    } finally { await cleanup(); }
  }
});

test('JSON prefix decoder and final validator enforce plain text and source IDs', () => {
  assert.equal(streamedAnswerPrefix('{"answer":"海峡\\n'), '海峡\n');
  assert.equal(streamedAnswerPrefix('{"answer":"海峡\\u'), '海峡');
  assert.throws(() => validateMapAnswer(JSON.stringify({ answer: 'https://bad.test',
    stepIds: ['hormuz-1'], sourceIds: ['iea-hormuz-factsheet'] })), /故事约束/);
  assert.throws(() => validateMapAnswer(JSON.stringify({ answer: '假数据',
    stepIds: ['hormuz-1'], sourceIds: ['iea-oct-2026'] })), /故事约束/);
  for (const answer of ['file:///secret', 'javascript:alert(1)', '{"type":"focus_region"}',
    'GeoJSON FeatureCollection', '请调用 add_overlay']) {
    assert.throws(() => validateMapAnswer(JSON.stringify({ answer,
      stepIds: ['hormuz-1'], sourceIds: ['iea-hormuz-factsheet'] })), /故事约束/);
  }
});
