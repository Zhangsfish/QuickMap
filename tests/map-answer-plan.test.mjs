import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'quickmap-answer-plan-test-'));
const output = join(directory, 'map-answer-plan.cjs');
await build({ entryPoints: ['src/shared/map-answer-plan.ts'], outfile: output, platform: 'node', format: 'cjs', bundle: true });
const require = createRequire(import.meta.url);
const { validateMapAnswerPlan } = require(output);
after(() => rm(directory, { recursive: true, force: true }));

const plan = {
  version: 1,
  question: '这条航路怎么走？',
  title: '航路示意',
  asOf: '2026-10-15',
  paragraphs: [{ id: 'p1', text: '示意线路连接两个位置。', layerIds: ['route1'], sourceIds: ['source1'] }],
  layers: [{ id: 'route1', type: 'geometry', label: '示意航线', representation: 'schematic', sourceIds: ['source1'], geometry: { type: 'LineString', coordinates: [[60, 70], [80, 75]] } }],
};

test('accepts linked paragraphs and sourced schematic geometry', () => {
  assert.equal(validateMapAnswerPlan(plan, new Set(['source1'])).layers[0].id, 'route1');
});

test('rejects unknown source and layer IDs before rendering', () => {
  assert.throws(() => validateMapAnswerPlan(plan, new Set()), /Unknown source ID/);
  assert.throws(() => validateMapAnswerPlan({ ...plan, paragraphs: [{ ...plan.paragraphs[0], layerIds: ['missing'] }] }, new Set(['source1'])), /Unknown layer ID/);
});

test('rejects invalid coordinates', () => {
  const invalid = { ...plan, layers: [{ ...plan.layers[0], geometry: { type: 'LineString', coordinates: [[600, 70], [80, 75]] } }] };
  assert.throws(() => validateMapAnswerPlan(invalid, new Set(['source1'])));
});

test('requires a source for geometry presented as sourced data', () => {
  const invalid = { ...plan, layers: [{ ...plan.layers[0], representation: 'sourced', sourceIds: [] }] };
  assert.throws(() => validateMapAnswerPlan(invalid, new Set(['source1'])), /Sourced geometry requires a source ID/);
});
