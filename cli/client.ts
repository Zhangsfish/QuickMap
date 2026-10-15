import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { mapCommandSchema, overlaySchema, type MapCommand } from '../src/shared/protocol';

const discoverySchema = z.object({
  protocol: z.literal(1),
  port: z.number().int().min(1).max(65535),
  token: z.string().regex(/^[0-9a-f]{64}$/),
});

export function defaultControlFile() {
  if (process.env.QUICKMAP_CONTROL_FILE) return process.env.QUICKMAP_CONTROL_FILE;
  const appData = process.platform === 'win32'
    ? process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
    : process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(appData, 'QuickMap', 'quickmap-control.json');
}

export async function readJsonFile(path: string) {
  if (path !== '-') {
    const input = await readFile(path, 'utf8');
    if (Buffer.byteLength(input) > 512 * 1024) throw new Error('Input exceeds 512 KiB.');
    return JSON.parse(input) as unknown;
  }
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 512 * 1024) throw new Error('Input exceeds 512 KiB.');
  }
  return JSON.parse(input) as unknown;
}

export async function parseCommand(args: string[]): Promise<MapCommand> {
  const [action, ...values] = args;
  let command: unknown;
  switch (action) {
    case 'region': command = { type: 'focus_region', query: values.join(' ') }; break;
    case 'story-step':
      if (values.length !== 1) throw new Error('Usage: story-step hormuz-1 (through hormuz-5)');
      command = { type: 'set_story_step', stepId: values[0] };
      break;
    case 'search': command = { type: 'search', query: values.join(' ') }; break;
    case 'show':
      if (values.length < 3 || values.length > 4) throw new Error('Usage: show "Place name" longitude latitude [description]');
      command = { type: 'show_place', label: values[0], lon: Number(values[1]), lat: Number(values[2]), description: values[3] };
      break;
    case 'overlay':
    case 'upsert-overlay':
      if (values.length !== 1) throw new Error('Usage: overlay file.json (or - for stdin)');
      command = { type: 'upsert_overlay', overlay: overlaySchema.parse(await readJsonFile(values[0])) };
      break;
    case 'circle': {
      if (values.length !== 5) throw new Error('Usage: circle overlay-id "Label" longitude latitude radius-km');
      const [id, label, lonText, latText, radiusText] = values;
      const lon = z.coerce.number().finite().min(-180).max(180).parse(lonText);
      const lat = z.coerce.number().finite().min(-90).max(90).parse(latText);
      const radius = z.coerce.number().finite().positive().max(5000).parse(radiusText);
      const radians = Math.PI / 180;
      const angularRadius = radius / 6371.0088;
      const centerLat = lat * radians;
      const coordinates: [number, number][] = [];
      for (let index = 0; index < 64; index++) {
        const bearing = -index / 64 * 2 * Math.PI;
        const pointLat = Math.asin(Math.sin(centerLat) * Math.cos(angularRadius) + Math.cos(centerLat) * Math.sin(angularRadius) * Math.cos(bearing));
        const pointLon = lon * radians + Math.atan2(Math.sin(bearing) * Math.sin(angularRadius) * Math.cos(centerLat), Math.cos(angularRadius) - Math.sin(centerLat) * Math.sin(pointLat));
        coordinates.push([((pointLon / radians + 540) % 360) - 180, pointLat / radians]);
      }
      coordinates.push([...coordinates[0]]);
      command = { type: 'upsert_overlay', overlay: { id, label, geometry: { type: 'Polygon', coordinates: [coordinates] } } };
      break;
    }
    case 'remove':
      if (values.length !== 1) throw new Error('Usage: remove overlay-id');
      command = { type: 'remove_overlay', id: values[0] };
      break;
    case 'clear':
      if (values.length !== 0) throw new Error('Usage: clear');
      command = { type: 'clear_overlays' };
      break;
    case 'command':
    case 'send-json':
      if (values.length !== 1) throw new Error('Usage: command file.json (or - for stdin)');
      command = await readJsonFile(values[0]);
      break;
    default: throw new Error(`Unknown command: ${action ?? '(none)'}. Run with --help.`);
  }
  return mapCommandSchema.parse(command);
}

export async function sendRequest(controlFile: string, endpoint: '/command' | '/health' | '/quit', command?: MapCommand) {
  let discovery: z.infer<typeof discoverySchema>;
  try { discovery = discoverySchema.parse(JSON.parse(await readFile(controlFile, 'utf8'))); }
  catch { throw new Error(`Could not read QuickMap control file at ${controlFile}. Start the desktop app first.`); }
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${discovery.port}${endpoint}`, {
      method: endpoint === '/health' ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${discovery.token}`, 'Content-Type': 'application/json' },
      body: endpoint === '/health' ? undefined : JSON.stringify(command ?? {}),
      signal: AbortSignal.timeout(5000),
    });
  } catch { throw new Error('QuickMap is not responding. Start or restart the desktop app.'); }
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error ?? `QuickMap returned HTTP ${response.status}.`);
  return result;
}
