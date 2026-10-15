import { z } from 'zod';

const longitude = z.number().finite().min(-180).max(180);
const latitude = z.number().finite().min(-90).max(90);
const position = z.tuple([longitude, latitude]);

const ring = z.array(position).min(4).superRefine((points, context) => {
  const first = points[0], last = points[points.length - 1];
  if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
    context.addIssue({ code: 'custom', message: 'Polygon rings must end at their starting coordinate' });
  }
  if (new Set(points.map(([lon, lat]) => `${lon},${lat}`)).size < 3) {
    context.addIssue({ code: 'custom', message: 'Polygon rings require at least three distinct vertices' });
  }
});

export const geometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: position }),
  z.object({ type: z.literal('MultiPoint'), coordinates: z.array(position).min(1) }),
  z.object({ type: z.literal('LineString'), coordinates: z.array(position).min(2) }),
  z.object({ type: z.literal('MultiLineString'), coordinates: z.array(z.array(position).min(2)).min(1) }),
  z.object({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(ring).min(1)).min(1) }),
]);

export const overlaySchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  source: z.string().max(300).optional(),
  expiresAt: z.string().datetime().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  geometry: geometrySchema,
});

export const mapCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('show_place'),
    label: z.string().min(1).max(200),
    lon: longitude,
    lat: latitude,
    description: z.string().max(2000).optional(),
    source: z.string().max(300).optional(),
  }),
  z.object({ type: z.literal('search'), query: z.string().min(1).max(200) }),
  z.object({ type: z.literal('focus_region'), query: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal('upsert_overlay'), overlay: overlaySchema }),
  z.object({ type: z.literal('remove_overlay'), id: z.string().min(1).max(100) }),
  z.object({ type: z.literal('clear_overlays') }),
]);

export type MapCommand = z.infer<typeof mapCommandSchema>;
export type MapOverlay = z.infer<typeof overlaySchema>;

export type QuickMapBridge = {
  onCommand: (listener: (command: MapCommand) => void) => () => void;
  ready: () => void;
  hide: () => Promise<void>;
  getClipboardText: () => Promise<string>;
};
