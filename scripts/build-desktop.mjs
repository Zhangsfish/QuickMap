import { build } from 'esbuild';

for (const [entry, output] of [
  ['electron/main.ts', 'dist-electron/main.cjs'],
  ['electron/preload.ts', 'dist-electron/preload.cjs'],
  ['cli/quickmap.ts', 'dist-electron/quickmap.cjs'],
  ['mcp/server.ts', 'dist-electron/mcp.cjs'],
]) {
  await build({
    entryPoints: [entry],
    outfile: output,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    bundle: true,
    external: ['electron'],
    sourcemap: true,
  });
}
