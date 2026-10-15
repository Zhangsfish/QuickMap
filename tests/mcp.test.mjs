import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const outputDirectory = await mkdtemp(join(tmpdir(), 'quickmap-mcp-test-'));
const outputFile = join(outputDirectory, 'mcp.cjs');
const buildOptions = { platform: 'node', format: 'cjs', target: 'node22', bundle: true };
await Promise.all([
  build({ ...buildOptions, entryPoints: [fileURLToPath(new URL('../mcp/server.ts', import.meta.url))], outfile: outputFile }),
  build({ ...buildOptions, entryPoints: [fileURLToPath(new URL('../cli/quickmap.ts', import.meta.url))], outfile: join(outputDirectory, 'quickmap.cjs') }),
  build({ ...buildOptions, entryPoints: [fileURLToPath(new URL('../electron/control.ts', import.meta.url))], outfile: join(outputDirectory, 'control.cjs') }),
]);
const mcp = await import(pathToFileURL(outputFile).href);
const require = createRequire(import.meta.url);
const { startControlServer } = require(join(outputDirectory, 'control.cjs'));

after(async () => rm(outputDirectory, { recursive: true, force: true }));

test('createCircleGeometry returns a valid closed geodesic polygon', () => {
  const geometry = mcp.createCircleGeometry(56.25, 26.55, 80, 36);
  assert.equal(geometry.type, 'Polygon');
  assert.equal(geometry.coordinates[0].length, 37);
  assert.deepEqual(geometry.coordinates[0][0], geometry.coordinates[0].at(-1));
  for (const [lon, lat] of geometry.coordinates[0]) {
    assert.ok(lon >= -180 && lon <= 180);
    assert.ok(lat >= -90 && lat <= 90);
  }

  const north = geometry.coordinates[0][0];
  assert.ok(north[1] > 26.55);
});

test('highlight_area builds a protocol-valid upsert command with a stable ID', () => {
  const input = {
    label: 'Strait of Hormuz',
    lon: 56.25,
    lat: 26.55,
    radiusKm: 80,
    description: 'Strategic waterway between Iran and Oman',
  };
  const first = mcp.buildHighlightAreaCommand(input);
  const second = mcp.buildHighlightAreaCommand(input);
  assert.equal(first.type, 'upsert_overlay');
  assert.equal(first.overlay.id, second.overlay.id);
  assert.equal(first.overlay.label, input.label);
  assert.equal(first.overlay.geometry.type, 'Polygon');
});

test('highlight_area rejects invalid coordinates and radius before contacting QuickMap', () => {
  assert.throws(
    () => mcp.buildHighlightAreaCommand({ label: 'Invalid', lon: 181, lat: 0, radiusKm: 10 }),
    /too big|<=180|180/i,
  );
  assert.throws(
    () => mcp.buildHighlightAreaCommand({ label: 'Invalid', lon: 0, lat: 0, radiusKm: 0 }),
    /too small|>0/i,
  );
});

test('add_overlay rejects malformed GeoJSON rings', () => {
  assert.throws(() => mcp.buildAddOverlayCommand({
    label: 'Broken polygon',
    geometryJson: JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] }),
  }));
  assert.throws(() => mcp.buildAddOverlayCommand({ label: 'Bad JSON', geometryJson: '{' }), /valid JSON/);
  assert.throws(() => mcp.buildAddOverlayCommand({ label: 'Feature not geometry', geometryJson: '{"type":"Feature","geometry":{"type":"Point","coordinates":[0,0]}}' }));
  assert.throws(() => mcp.buildAddOverlayCommand({ label: 'Object input', geometryJson: { type: 'Point', coordinates: [0, 0] } }));
});

test('MCP exposes tools, sends an area command, and rejects bad parameters', async () => {
  const sent = [];
  const server = mcp.createQuickMapMcpServer(async (command) => { sent.push(command); });
  const client = new Client({ name: 'quickmap-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map(({ name }) => name).sort(),
      ['add_overlay', 'clear_overlays', 'focus_region', 'highlight_area', 'remove_overlay', 'search_place', 'set_story_step', 'show_place'],
    );
    const overlayTool = tools.tools.find(({ name }) => name === 'add_overlay');
    assert.equal(overlayTool.inputSchema.properties.geometryJson.type, 'string');
    assert.equal('geometry' in overlayTool.inputSchema.properties, false);

    const added = await client.callTool({
      name: 'add_overlay',
      arguments: { label: 'Test route', geometryJson: JSON.stringify({ type: 'LineString', coordinates: [[56, 26], [70, 20]] }) },
    });
    assert.notEqual(added.isError, true);
    assert.equal(sent[0].type, 'upsert_overlay');
    assert.deepEqual(sent[0].overlay.geometry, { type: 'LineString', coordinates: [[56, 26], [70, 20]] });

    const invalidOverlay = await client.callTool({ name: 'add_overlay', arguments: { label: 'Invalid', geometryJson: '{' } });
    assert.equal(invalidOverlay.isError, true);
    assert.equal(sent.length, 1);

    const step = await client.callTool({ name: 'set_story_step', arguments: { stepId: 'hormuz-3' } });
    assert.notEqual(step.isError, true);
    assert.deepEqual(sent[1], { type: 'set_story_step', stepId: 'hormuz-3' });
    const invalidStep = await client.callTool({ name: 'set_story_step', arguments: { stepId: 'custom' } });
    assert.equal(invalidStep.isError, true);
    assert.equal(sent.length, 2);

    const accepted = await client.callTool({
      name: 'highlight_area',
      arguments: { label: '北方四岛', lon: 146.5, lat: 44.5, radiusKm: 250 },
    });
    assert.notEqual(accepted.isError, true);
    assert.equal(sent.length, 3);
    assert.equal(sent[2].type, 'upsert_overlay');
    assert.equal(sent[2].overlay.geometry.type, 'Polygon');

    const result = await client.callTool({
      name: 'highlight_area',
      arguments: { label: 'Bad latitude', lon: 10, lat: 91, radiusKm: 50 },
    });
    assert.equal(result.isError, true);
    assert.equal(sent.length, 3);
  } finally {
    await client.close();
    await server.close();
  }
});

test('built stdio MCP invokes the adjacent CLI and reaches the authenticated control server', async () => {
  const received = [];
  const control = await startControlServer({
    onCommand(command) { received.push(command); return true; },
    onQuit() {},
  });
  const controlFile = join(outputDirectory, 'stdio-control.json');
  await writeFile(controlFile, JSON.stringify({ protocol: 1, port: control.port, token: control.token }));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [outputFile],
    env: { ...getDefaultEnvironment(), QUICKMAP_CONTROL_FILE: controlFile },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'quickmap-stdio-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some(({ name }) => name === 'highlight_area'));
    const overlayTool = tools.tools.find(({ name }) => name === 'add_overlay');
    assert.equal(overlayTool.inputSchema.properties.geometryJson.type, 'string');
    const result = await client.callTool({
      name: 'highlight_area',
      arguments: { label: '北方四岛', lon: 146.5, lat: 44.5, radiusKm: 250 },
    });
    assert.notEqual(result.isError, true);
    assert.equal(received.length, 1);
    assert.equal(received[0].type, 'upsert_overlay');
    assert.equal(received[0].overlay.label, '北方四岛');
    assert.equal(received[0].overlay.geometry.type, 'Polygon');
    for (const query of ['UK', '英国', 'Hong Kong', '香港']) {
      const focused = await client.callTool({ name: 'focus_region', arguments: { query } });
      assert.notEqual(focused.isError, true);
      assert.deepEqual(received.at(-1), { type: 'focus_region', query });
    }
    const overlayResult = await client.callTool({
      name: 'add_overlay',
      arguments: { label: 'Route', geometryJson: JSON.stringify({ type: 'LineString', coordinates: [[56, 26], [70, 20]] }) },
    });
    assert.notEqual(overlayResult.isError, true);
    assert.equal(received.at(-1).overlay.geometry.type, 'LineString');
    const storyResult = await client.callTool({ name: 'set_story_step', arguments: { stepId: 'hormuz-5' } });
    assert.notEqual(storyResult.isError, true);
    assert.deepEqual(received.at(-1), { type: 'set_story_step', stepId: 'hormuz-5' });
    assert.equal(received.length, 7);
    const invalid = await client.callTool({ name: 'focus_region', arguments: { query: '   ' } });
    assert.equal(invalid.isError, true);
    assert.equal(received.length, 7);
  } finally {
    await client.close();
    await control.close();
  }
});
