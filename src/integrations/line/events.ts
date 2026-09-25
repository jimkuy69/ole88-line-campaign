import { z } from 'zod';

const lineEventSchema = z.object({
  webhookEventId: z.string().min(1),
  type: z.string().min(1),
  deliveryContext: z.object({ isRedelivery: z.boolean().optional() }).passthrough().optional(),
}).passthrough();

export const lineWebhookSchema = z.object({
  destination: z.string().optional(),
  events: z.array(lineEventSchema).max(100),
}).passthrough();

export type LineWebhookEvent = z.infer<typeof lineEventSchema>;
export type LineWebhookEnvelope = z.infer<typeof lineWebhookSchema>;

export function parseLineWebhook(input: unknown): LineWebhookEnvelope {
  return lineWebhookSchema.parse(input);
}

export type NormalizedLineEvent = {
  providerEventId: string;
  type: string;
  isRedelivery: boolean;
  payload: Record<string, unknown>;
};

export function normalizeLineEvent(event: LineWebhookEvent): NormalizedLineEvent {
  return {
    providerEventId: event.webhookEventId,
    type: event.type,
    isRedelivery: event.deliveryContext?.isRedelivery ?? false,
    payload: event as Record<string, unknown>,
  };
}
