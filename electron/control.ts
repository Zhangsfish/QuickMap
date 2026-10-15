import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mapCommandSchema, type MapCommand } from '../src/shared/protocol';

export const MAX_BODY_BYTES = 512 * 1024;

export class CommandQueue {
  private pending: MapCommand[] = [];
  private receiver: ((command: MapCommand) => void) | undefined;

  enqueue(command: MapCommand): boolean {
    if (this.receiver) this.receiver(command);
    else {
      if (this.pending.length >= 100) return false;
      this.pending.push(command);
    }
    return true;
  }

  pause() { this.receiver = undefined; }

  ready(receiver: (command: MapCommand) => void) {
    this.receiver = receiver;
    for (const command of this.pending.splice(0)) receiver(command);
  }
}

function reply(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        chunks.length = 0;
        reject(new Error('Request body exceeds 512 KiB.'));
      } else chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
    request.on('aborted', () => reject(new Error('Request aborted.')));
  });
}

export async function startControlServer(options: {
  onCommand: (command: MapCommand) => boolean;
  onQuit: () => void;
}) {
  const token = randomBytes(32).toString('hex');
  const expectedAuthorization = Buffer.from(`Bearer ${token}`);
  const server = createServer(async (request, response) => {
    // Browser pages must never be able to drive the desktop app.
    if (request.headers.origin || request.headers['sec-fetch-site']) {
      reply(response, 403, { error: 'Browser requests are not allowed.' });
      return;
    }
    const address = server.address();
    if (!address || typeof address === 'string' || request.headers.host !== `127.0.0.1:${address.port}`) {
      reply(response, 403, { error: 'Invalid host.' });
      return;
    }
    const authorization = Buffer.from(request.headers.authorization ?? '');
    if (authorization.length !== expectedAuthorization.length || !timingSafeEqual(authorization, expectedAuthorization)) {
      reply(response, 401, { error: 'Authentication required.' });
      return;
    }
    if (request.method === 'GET' && request.url === '/health') {
      reply(response, 200, { ok: true, app: 'QuickMap', protocol: 1 });
      return;
    }
    if (request.method !== 'POST' || !['/command', '/quit'].includes(request.url ?? '')) {
      reply(response, 404, { error: 'Unknown endpoint.' });
      return;
    }
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      reply(response, 415, { error: 'Use application/json.' });
      return;
    }
    let body: string;
    try { body = await readBody(request); }
    catch {
      reply(response, 413, { error: 'Request body exceeds 512 KiB or was interrupted.' });
      return;
    }
    let payload: unknown;
    try { payload = JSON.parse(body); }
    catch {
      reply(response, 400, { error: 'Invalid JSON.' });
      return;
    }
    if (request.url === '/quit') {
      reply(response, 200, { ok: true });
      setImmediate(options.onQuit);
      return;
    }
    const parsed = mapCommandSchema.safeParse(payload);
    if (!parsed.success) {
      reply(response, 400, { error: 'Invalid map command.', issues: parsed.error.issues });
      return;
    }
    try {
      if (!options.onCommand(parsed.data)) {
        reply(response, 503, { error: 'Map is loading and its command queue is full. Retry shortly.' });
        return;
      }
      reply(response, 202, { ok: true, accepted: true });
    } catch {
      reply(response, 500, { error: 'The map could not accept this command.' });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.timeout = 10_000;
  server.maxConnections = 32;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not bind local control server.');
  return {
    port: address.port,
    token,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
