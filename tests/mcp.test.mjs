import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const outputDirectory = await mkdtemp(join(tmpdir(), 'quickmap-mcp-test-'));
const outputFile = join(outputDirectory, 'mcp.cjs');
await build({
  entryPoints: [new URL('../mcp/server.ts', import.meta.url).pathname],
  outfile: outputFile,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  bundle: true,
});
const mcp = await import(outputFile);

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
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] },
  }));
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
      ['add_overlay', 'clear_overlays', 'highlight_area', 'remove_overlay', 'search_place', 'show_place'],
    );

    const accepted = await client.callTool({
      name: 'highlight_area',
      arguments: { label: '北方四岛', lon: 146.5, lat: 44.5, radiusKm: 250 },
    });
    assert.notEqual(accepted.isError, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'upsert_overlay');
    assert.equal(sent[0].overlay.geometry.type, 'Polygon');

    const result = await client.callTool({
      name: 'highlight_area',
      arguments: { label: 'Bad latitude', lon: 10, lat: 91, radiusKm: 50 },
    });
    assert.equal(result.isError, true);
    assert.equal(sent.length, 1);
  } finally {
    await client.close();
    await server.close();
  }
});
