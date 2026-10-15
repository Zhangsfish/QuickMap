import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  geometrySchema,
  mapCommandSchema,
  type MapCommand,
  type MapOverlay,
} from '../src/shared/protocol';

const EARTH_RADIUS_KM = 6371.0088;
const DEFAULT_CIRCLE_SEGMENTS = 72;

const labelSchema = z.string().trim().min(1).max(200);
const descriptionSchema = z.string().max(2000).optional();
const sourceSchema = z.string().max(300).optional();
const longitudeSchema = z.number().finite().min(-180).max(180);
const latitudeSchema = z.number().finite().min(-90).max(90);

export const showPlaceInputSchema = z.object({
  label: labelSchema.describe('Human-readable place label'),
  lat: latitudeSchema.describe('Latitude in decimal degrees'),
  lon: longitudeSchema.describe('Longitude in decimal degrees'),
  description: descriptionSchema.describe('Optional short context shown with the place'),
  source: sourceSchema.describe('Optional source or attribution'),
});

export const highlightAreaInputSchema = z.object({
  label: labelSchema.describe('Human-readable area label'),
  lon: longitudeSchema.describe('Center longitude in decimal degrees'),
  lat: latitudeSchema.describe('Center latitude in decimal degrees'),
  radiusKm: z.number().finite().positive().max(20_000).describe('Circle radius in kilometers'),
  description: descriptionSchema.describe('Optional short context shown with the area'),
  source: sourceSchema.describe('Optional source or attribution'),
});

export const addOverlayInputSchema = z.object({
  id: z.string().trim().min(1).max(100).optional().describe('Stable ID used to update or remove this overlay'),
  label: labelSchema.describe('Human-readable overlay label'),
  geometry: geometrySchema.describe('GeoJSON geometry with longitude, latitude coordinate order'),
  description: descriptionSchema.describe('Optional short context shown with the overlay'),
  source: sourceSchema.describe('Optional source or attribution'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('Optional six-digit hex color'),
});

export const searchPlaceInputSchema = z.object({
  query: z.string().trim().min(1).max(200).describe('Place name to search for in QuickMap'),
});

export const removeOverlayInputSchema = z.object({
  id: z.string().trim().min(1).max(100).describe('Overlay ID returned by highlight_area or add_overlay'),
});

function radians(value: number) {
  return value * Math.PI / 180;
}

function degrees(value: number) {
  return value * 180 / Math.PI;
}

function normalizeLongitude(value: number) {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

/** Build a geodesic circle as a closed GeoJSON Polygon ring. */
export function createCircleGeometry(lon: number, lat: number, radiusKm: number, segments = DEFAULT_CIRCLE_SEGMENTS) {
  longitudeSchema.parse(lon);
  latitudeSchema.parse(lat);
  z.number().finite().positive().max(20_000).parse(radiusKm);
  z.number().int().min(16).max(360).parse(segments);

  const centerLon = radians(lon);
  const centerLat = radians(lat);
  const angularDistance = radiusKm / EARTH_RADIUS_KM;
  const ring: [number, number][] = [];

  for (let index = 0; index < segments; index += 1) {
    const bearing = 2 * Math.PI * index / segments;
    const pointLat = Math.asin(
      Math.sin(centerLat) * Math.cos(angularDistance)
      + Math.cos(centerLat) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const pointLon = centerLon + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(centerLat),
      Math.cos(angularDistance) - Math.sin(centerLat) * Math.sin(pointLat),
    );
    ring.push([normalizeLongitude(degrees(pointLon)), degrees(pointLat)]);
  }
  ring.push([...ring[0]]);
  return geometrySchema.parse({ type: 'Polygon', coordinates: [ring] });
}

function generatedOverlayId(label: string, value: unknown) {
  const slug = label
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'overlay';
  const digest = createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 10);
  return `${slug}-${digest}`;
}

export function buildHighlightAreaCommand(input: unknown): MapCommand {
  const parsed = highlightAreaInputSchema.parse(input);
  const geometry = createCircleGeometry(parsed.lon, parsed.lat, parsed.radiusKm);
  const overlay: MapOverlay = {
    id: generatedOverlayId(parsed.label, { lon: parsed.lon, lat: parsed.lat, radiusKm: parsed.radiusKm }),
    label: parsed.label,
    geometry,
    ...(parsed.description === undefined ? {} : { description: parsed.description }),
    ...(parsed.source === undefined ? {} : { source: parsed.source }),
  };
  return mapCommandSchema.parse({ type: 'upsert_overlay', overlay });
}

export function buildAddOverlayCommand(input: unknown): MapCommand {
  const parsed = addOverlayInputSchema.parse(input);
  const overlay = {
    ...parsed,
    id: parsed.id ?? generatedOverlayId(parsed.label, parsed.geometry),
  };
  return mapCommandSchema.parse({ type: 'upsert_overlay', overlay });
}

export async function sendMapCommand(command: unknown, options: {
  cliPath?: string;
  spawnProcess?: typeof spawn;
} = {}) {
  const validated = mapCommandSchema.parse(command);
  const cliPath = options.cliPath ?? join(__dirname, 'quickmap.cjs');
  const spawnProcess = options.spawnProcess ?? spawn;

  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess(process.execPath, [cliPath, 'command', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    let diagnostics = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { output += chunk; });
    child.stderr.on('data', (chunk: string) => { diagnostics += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(diagnostics.trim() || output.trim() || `QuickMap CLI exited with code ${code}.`));
    });
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify(validated));
  });
  return validated;
}

function success(message: string, details?: Record<string, unknown>) {
  const value = details ? { ok: true, message, ...details } : { ok: true, message };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

export function createQuickMapMcpServer(sendCommand: (command: unknown) => Promise<unknown> = sendMapCommand) {
  const server = new McpServer({ name: 'quickmap', version: '0.1.0' });

  server.registerTool('show_place', {
    description: 'Show and label a point on QuickMap. Infer coordinates from your own geographic knowledge when you know them.',
    inputSchema: showPlaceInputSchema,
  }, async (input) => {
    const command = mapCommandSchema.parse({ type: 'show_place', ...input });
    await sendCommand(command);
    return success(`Showing ${input.label}.`);
  });

  server.registerTool('highlight_area', {
    description: 'Circle and label a geographic area on QuickMap. For regions, islands, straits, seas, and disputed areas, infer a representative center and radius from your own reasoning and call this directly.',
    inputSchema: highlightAreaInputSchema,
  }, async (input) => {
    const command = buildHighlightAreaCommand(input);
    await sendCommand(command);
    if (command.type !== 'upsert_overlay') throw new Error('Unexpected command type.');
    return success(`Highlighted ${input.label}.`, { overlayId: command.overlay.id });
  });

  server.registerTool('add_overlay', {
    description: 'Add or update a labeled GeoJSON geometry on QuickMap. Coordinates must use longitude, latitude order.',
    inputSchema: addOverlayInputSchema,
  }, async (input) => {
    const command = buildAddOverlayCommand(input);
    await sendCommand(command);
    if (command.type !== 'upsert_overlay') throw new Error('Unexpected command type.');
    return success(`Added ${input.label}.`, { overlayId: command.overlay.id });
  });

  server.registerTool('search_place', {
    description: 'Ask QuickMap to search its local place index. Use when exact coordinates are unknown and the request is for a named place.',
    inputSchema: searchPlaceInputSchema,
  }, async ({ query }) => {
    await sendCommand(mapCommandSchema.parse({ type: 'search', query }));
    return success(`Searched QuickMap for ${query}.`);
  });

  server.registerTool('remove_overlay', {
    description: 'Remove one QuickMap overlay by its ID.',
    inputSchema: removeOverlayInputSchema,
  }, async ({ id }) => {
    await sendCommand(mapCommandSchema.parse({ type: 'remove_overlay', id }));
    return success(`Removed overlay ${id}.`);
  });

  server.registerTool('clear_overlays', {
    description: 'Remove all overlays from QuickMap.',
    annotations: { destructiveHint: true },
  }, async () => {
    await sendCommand(mapCommandSchema.parse({ type: 'clear_overlays' }));
    return success('Cleared all overlays.');
  });

  return server;
}

async function main() {
  const server = createQuickMapMcpServer();
  await server.connect(new StdioServerTransport());
  console.error('QuickMap MCP server listening on stdio.');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'QuickMap MCP server failed.');
    process.exitCode = 1;
  });
}
