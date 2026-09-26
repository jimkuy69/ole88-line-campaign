import { z } from 'zod';

const imageHotspotSchema = z.object({
  id: z.string().uuid().optional(),
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
  assetId: z.string().uuid().optional(),
  metadata: z.object({
    originalFilename: z.string().min(1).max(255),
    contentType: z.enum(['image/jpeg', 'image/png']),
    fileSizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
    width: z.number().int().positive().max(4096),
    height: z.number().int().positive().max(4096),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict().optional(),
}).strict();

export const imageHotspotMapsSchema = z.array(imageMapSchema).max(4).superRefine((maps, context) => {
  const assets = new Set<string>();
  const hotspotIds = new Set<string>();
  maps.forEach((map, mapIndex) => {
    if (map.assetId) {
      if (assets.has(map.assetId)) {
        context.addIssue({
          code: 'custom',
          path: [mapIndex, 'assetId'],
          message: 'The same uploaded image cannot be added to a plan more than once.',
        });
      }
      assets.add(map.assetId);
    }
    map.hotspots.forEach((hotspot, hotspotIndex) => {
      if (!hotspot.id) return;
      if (hotspotIds.has(hotspot.id)) {
        context.addIssue({
          code: 'custom',
          path: [mapIndex, 'hotspots', hotspotIndex, 'id'],
          message: 'Hotspot IDs must be unique within the image plan.',
        });
      }
      hotspotIds.add(hotspot.id);
    });
  });
});
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
