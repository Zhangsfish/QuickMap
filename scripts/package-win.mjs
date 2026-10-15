import { copyFile, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(root, 'release');

if (process.platform !== 'win32' && process.platform !== 'linux') {
  throw new Error('Windows packaging is supported from Windows or Linux');
}

await mkdir(release, { recursive: true });
const [bundle] = await packager({
  dir: root,
  name: 'QuickMap',
  platform: 'win32',
  arch: 'x64',
  download: { cacheRoot: process.env.QUICKMAP_ELECTRON_CACHE || path.join(root, '.electron-cache') },
  out: release,
  overwrite: true,
  asar: true,
  prune: true,
  ignore: [
    /^\/release(?:\/|$)/,
    /^\/tests(?:\/|$)/,
    /^\/scripts(?:\/|$)/,
    /^\/src(?:\/|$)/,
    /^\/electron(?:\/|$)/,
    /^\/cli(?:\/|$)/,
    /^\/mcp(?:\/|$)/,
    /^\/\.git(?:\/|$)/,
    /^\/\.electron-cache(?:\/|$)/,
  ],
});

const controlDir = path.join(bundle, 'control');
await mkdir(controlDir, { recursive: true });
await copyFile(path.join(root, 'dist-electron/quickmap.cjs'), path.join(controlDir, 'quickmap.cjs'));
await copyFile(path.join(root, 'dist-electron/mcp.cjs'), path.join(controlDir, 'mcp.cjs'));
const zipName = 'QuickMap-win32-x64.zip';
await rm(path.join(release, zipName), { force: true });
await new Promise((resolve, reject) => {
  const windows = process.platform === 'win32';
  const command = windows ? 'powershell.exe' : 'zip';
  const args = windows
    ? ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -LiteralPath '${path.basename(bundle)}' -DestinationPath '${zipName}' -Force`]
    : ['-qr', zipName, path.basename(bundle)];
  const child = spawn(command, args, { cwd: release, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
});
console.log(`Windows bundle: ${bundle}`);
console.log(`Local AI control scripts: ${controlDir}`);
console.log(`Archive: ${path.join(release, zipName)}`);
