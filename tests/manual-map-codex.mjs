// Manual live smoke test: node tests/manual-map-codex.mjs
// Uses an ephemeral Codex thread and a temporary QuickMap data directory.
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const directory = await mkdtemp(join(tmpdir(), 'quickmap-live-app-server-'));
const file = join(directory, 'map-codex.cjs');
await build({ entryPoints: ['electron/map-codex.ts'], outfile: file,
  platform: 'node', format: 'cjs', target: 'node22', bundle: true });
const require = createRequire(import.meta.url);
const { MapCodexSession } = require(file);
let settle;
const done = new Promise((resolve) => { settle = resolve; });
const events = [];
const session = new MapCodexSession({ dataDir: join(directory, 'profile'), ephemeral: true,
  onEvent(event) {
    events.push(event);
    if (event.type === 'delta') process.stdout.write(event.text);
    if (event.type === 'error' || event.type === 'completed') settle(event);
  },
});
try {
  session.ask('霍尔木兹海峡为什么重要？请结合地图故事简要解释。');
  const final = await done;
  process.stdout.write(`\nFinal: ${JSON.stringify(final)}\n`);
  process.stdout.write(`Event types: ${events.map((event) => event.type).join(', ')}\n`);
  if (final.type !== 'completed') process.exitCode = 1;
} finally {
  await session.close();
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
