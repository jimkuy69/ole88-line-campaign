import { z } from 'zod';

const imageHotspotSchema = z.object({
  targetType: z.enum(['button', 'activity']),
  targetKey: z.string().min(1).max(100),
  x: z.number().int().min(0).max(1000),
  y: z.number().int().min(0).max(1000),
  width: z.number().int().min(1).max(1000),
  height: z.number().int().min(1).max(1000),
}).strict().superRefine((hotspot, context) => {
  if (hotspot.x + hotspot.width > 1000) {
    context.addIssue({ code: 'custom', path: ['width'], message: 'Hotspot must stay within the image bounds.' });
  }
  if (hotspot.y + hotspot.height > 1000) {
    context.addIssue({ code: 'custom', path: ['height'], message: 'Hotspot must stay within the image bounds.' });
  }
});

const imageMapSchema = z.object({
  imageUrl: z.string().url().max(2000),
  hotspots: z.array(imageHotspotSchema).max(50),
}).strict();

export const imageHotspotMapsSchema = z.array(imageMapSchema).max(4);
export type ImageHotspotMaps = z.infer<typeof imageHotspotMapsSchema>;

type Target = { key: string; label: string; actionType: string; actionValue: string | null; enabled: boolean };

export function validateImageHotspotTargets(
  maps: ImageHotspotMaps,
  buttons: Target[],
  activities: Target[],
) {
  const issues: Array<{ path: Array<string | number>; message: string }> = [];
  maps.forEach((map, mapIndex) => map.hotspots.forEach((hotspot, hotspotIndex) => {
    const options = hotspot.targetType === 'button' ? buttons : activities;
    if (!options.some((target) => target.key === hotspot.targetKey && target.enabled)) {
      issues.push({
        path: ['campaign', 'settings', 'imageHotspots', mapIndex, 'hotspots', hotspotIndex, 'targetKey'],
        message: `Hotspot target ${hotspot.targetKey} must reference an enabled ${hotspot.targetType}.`,
      });
    }
  }));
  return issues;
}

export function buildImageHotspotExport(
  campaign: { code: string; title: string | null },
  maps: ImageHotspotMaps,
  buttons: Target[],
  activities: Target[],
) {
  return {
    format: 'ole88-image-hotspot-plan/v1',
    campaign: { code: campaign.code, title: campaign.title },
    images: maps.map((map) => ({
      imageUrl: map.imageUrl,
      hotspots: map.hotspots.map((hotspot) => {
        const targets = hotspot.targetType === 'button' ? buttons : activities;
        const target = targets.find((item) => item.key === hotspot.targetKey);
        if (!target) throw new Error(`Missing hotspot target ${hotspot.targetKey}.`);
        return {
          area: { x: hotspot.x, y: hotspot.y, width: hotspot.width, height: hotspot.height, coordinateScale: 1000 },
          target: {
            type: hotspot.targetType,
            key: hotspot.targetKey,
            label: target.label,
            actionType: target.actionType,
            actionValue: target.actionValue,
          },
        };
      }),
    })),
  };
}
