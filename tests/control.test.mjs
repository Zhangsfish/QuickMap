import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { request } from 'node:http';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'quickmap-control-tests-'));
await build({ entryPoints: ['electron/control.ts', 'cli/client.ts'], outdir: directory, outbase: '.', platform: 'node', format: 'cjs', bundle: true });
const require = createRequire(import.meta.url);
const { startControlServer, CommandQueue, MAX_BODY_BYTES } = require(join(directory, 'electron/control.js'));
const { parseCommand, sendRequest } = require(join(directory, 'cli/client.js'));
after(() => rm(directory, { recursive: true, force: true }));

test('commands wait for renderer readiness and remain bounded', () => {
  const queue = new CommandQueue();
  const received = [];
  for (let index = 0; index < 100; index++) assert.equal(queue.enqueue({ type: 'search', query: `${index}` }), true);
  assert.equal(queue.enqueue({ type: 'clear_overlays' }), false);
  queue.ready((command) => received.push(command));
  assert.equal(received.length, 100);
  assert.equal(received[0].query, '0');
  assert.equal(received[99].query, '99');
  queue.pause();
  queue.enqueue({ type: 'clear_overlays' });
  assert.equal(received.length, 100);
  queue.ready((command) => received.push(command));
  assert.equal(received[100].type, 'clear_overlays');
});

test('local API requires token, rejects browsers and malformed or oversized commands', async () => {
  const commands = [];
  const server = await startControlServer({ onCommand: (command) => { commands.push(command); return true; }, onQuit() {} });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const headers = { Authorization: `Bearer ${server.token}`, 'Content-Type': 'application/json' };
    assert.equal((await fetch(`${base}/health`)).status, 401);
    assert.equal((await fetch(`${base}/health`, { headers: { ...headers, Origin: 'https://example.com' } })).status, 403);
    const invalidHostStatus = await new Promise((resolve, reject) => {
      const outgoing = request(`${base}/health`, { headers: { ...headers, Host: 'attacker.example' } }, (response) => { response.resume(); resolve(response.statusCode); });
      outgoing.on('error', reject);
      outgoing.end();
    });
    assert.equal(invalidHostStatus, 403);
    assert.equal((await fetch(`${base}/health`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/command`, { method: 'POST', headers, body: '{' })).status, 400);
    assert.equal((await fetch(`${base}/command`, { method: 'POST', headers, body: JSON.stringify({ type: 'show_place', label: 'bad', lon: 500, lat: 0 }) })).status, 400);
    assert.equal((await fetch(`${base}/command`, { method: 'POST', headers, body: 'x'.repeat(MAX_BODY_BYTES + 1) })).status, 413);
    assert.equal(commands.length, 0);
    const command = { type: 'show_place', label: 'Tokyo', lon: 139.6917, lat: 35.6895 };
    const response = await fetch(`${base}/command`, { method: 'POST', headers, body: JSON.stringify(command) });
    assert.equal(response.status, 202);
    assert.deepEqual(commands, [command]);
  } finally { await server.close(); }
});

test('CLI discovers local server and sends validated overlay and place commands', async () => {
  const received = [];
  const server = await startControlServer({ onCommand: (command) => { received.push(command); return true; }, onQuit() {} });
  try {
    const file = join(directory, 'control.json');
    await writeFile(file, JSON.stringify({ protocol: 1, port: server.port, token: server.token }));
    const place = await parseCommand(['show', 'Tokyo', '139.6917', '35.6895']);
    assert.equal((await sendRequest(file, '/command', place)).accepted, true);
    assert.equal(received[0].label, 'Tokyo');
    const circle = await parseCommand(['circle', 'islands', 'Northern islands', '146.5', '44.5', '250']);
    assert.equal(circle.type, 'upsert_overlay');
    assert.equal(circle.overlay.geometry.type, 'Polygon');
    assert.equal(circle.overlay.geometry.coordinates[0].length, 65);
    assert.deepEqual(circle.overlay.geometry.coordinates[0][0], circle.overlay.geometry.coordinates[0].at(-1));
    await sendRequest(file, '/command', circle);
    assert.equal(received[1].overlay.id, 'islands');
    await assert.rejects(parseCommand(['show', 'Bad', 'Infinity', '0']));
    await assert.rejects(parseCommand(['circle', 'bad', 'Bad', '0', '0', '-1']));
    await assert.rejects(parseCommand(['search', '']));
    const overlayFile = join(directory, 'overlay.json');
    await writeFile(overlayFile, JSON.stringify(circle.overlay));
    assert.deepEqual(await parseCommand(['upsert-overlay', overlayFile]), circle);
  } finally { await server.close(); }
});

test('API reports queue backpressure and supports explicit quit', async () => {
  let quit = false;
  const server = await startControlServer({ onCommand: () => false, onQuit: () => { quit = true; } });
  try {
    const headers = { Authorization: `Bearer ${server.token}`, 'Content-Type': 'application/json' };
    const base = `http://127.0.0.1:${server.port}`;
    assert.equal((await fetch(`${base}/command`, { method: 'POST', headers, body: '{"type":"clear_overlays"}' })).status, 503);
    assert.equal((await fetch(`${base}/quit`, { method: 'POST', headers, body: '{}' })).status, 200);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(quit, true);
  } finally { await server.close(); }
});
