import { z } from 'zod';
import { mapAnswerDocumentSchema } from './map-answer-plan';
import { geometrySchema, latitude, longitude } from './geometry';
export { geometrySchema } from './geometry';

export const overlaySchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  source: z.string().max(300).optional(),
  expiresAt: z.string().datetime().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  geometry: geometrySchema,
});

// Only steps bundled with QuickMap may be selected by an external control client.
export const STORY_STEP_IDS = ['hormuz-1', 'hormuz-2', 'hormuz-3', 'hormuz-4', 'hormuz-5'] as const;
export const storyStepIdSchema = z.enum(STORY_STEP_IDS);
export type StoryStepId = z.infer<typeof storyStepIdSchema>;

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
  z.object({ type: z.literal('set_story_step'), stepId: storyStepIdSchema }),
  z.object({ type: z.literal('show_answer'), document: mapAnswerDocumentSchema }),
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
