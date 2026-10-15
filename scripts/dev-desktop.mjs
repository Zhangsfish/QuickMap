import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';
import './build-desktop.mjs';

const server = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: false } });
await server.listen();
const address = server.httpServer.address();
if (!address || typeof address === 'string') throw new Error('Vite did not start.');
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, QUICKMAP_DEV_URL: `http://127.0.0.1:${address.port}` },
});
let closing = false;
async function stop(code = 0) {
  if (closing) return;
  closing = true;
  child.kill();
  await server.close();
  process.exit(code);
}
child.on('error', (error) => { console.error(error.message); void stop(1); });
child.on('exit', (code) => { void stop(code ?? 0); });
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
