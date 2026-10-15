import { z } from 'zod';
import { geometrySchema } from './protocol';

const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/);
const sourceIds = z.array(id).max(20);

const paragraphSchema = z.object({
  id,
  heading: z.string().trim().min(1).max(160).optional(),
  text: z.string().trim().min(1).max(4000),
  layerIds: z.array(id).max(20),
  sourceIds,
}).strict();

const layerBase = {
  id,
  label: z.string().trim().min(1).max(200),
  sourceIds,
};

const layerSchema = z.discriminatedUnion('type', [
  z.object({ ...layerBase, type: z.literal('feature'), featureId: id }).strict(),
  z.object({
    ...layerBase,
    type: z.literal('geometry'),
    geometry: geometrySchema,
    representation: z.enum(['schematic', 'sourced']),
    asOf: z.iso.date().optional(),
  }).strict().superRefine((layer, context) => {
    if (layer.representation === 'sourced' && layer.sourceIds.length === 0) {
      context.addIssue({ code: 'custom', message: 'Sourced geometry requires a source ID' });
    }
  }),
]);

/** A model proposal. A trusted source registry supplies titles and URLs separately. */
export const mapAnswerPlanSchema = z.object({
  version: z.literal(1),
  question: z.string().trim().min(1).max(2000),
  title: z.string().trim().min(1).max(200),
  asOf: z.iso.date(),
  paragraphs: z.array(paragraphSchema).min(1).max(30),
  layers: z.array(layerSchema).max(50),
}).strict().superRefine((plan, context) => {
  const paragraphIds = plan.paragraphs.map((paragraph) => paragraph.id);
  const layerIds = plan.layers.map((layer) => layer.id);
  if (new Set(paragraphIds).size !== paragraphIds.length) {
    context.addIssue({ code: 'custom', message: 'Duplicate paragraph IDs' });
  }
  if (new Set(layerIds).size !== layerIds.length) {
    context.addIssue({ code: 'custom', message: 'Duplicate layer IDs' });
  }
  const knownLayers = new Set(layerIds);
  for (const paragraph of plan.paragraphs) {
    for (const layerId of paragraph.layerIds) {
      if (!knownLayers.has(layerId)) context.addIssue({ code: 'custom', message: `Unknown layer ID: ${layerId}` });
    }
  }
});

export type MapAnswerPlan = z.infer<typeof mapAnswerPlanSchema>;

/** Resolve references against sources fetched and checked outside the model. */
export function validateMapAnswerPlan(value: unknown, allowedSourceIds: ReadonlySet<string>): MapAnswerPlan {
  const plan = mapAnswerPlanSchema.parse(value);
  for (const item of [...plan.paragraphs, ...plan.layers]) {
    for (const sourceId of item.sourceIds) {
      if (!allowedSourceIds.has(sourceId)) throw new Error(`Unknown source ID: ${sourceId}`);
    }
  }
  return plan;
}
