import { z } from 'zod';

export const longitude = z.number().finite().min(-180).max(180);
export const latitude = z.number().finite().min(-90).max(90);
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
