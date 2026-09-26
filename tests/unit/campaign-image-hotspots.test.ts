import { describe, expect, it } from 'vitest';
import { buildImageHotspotExport, imageHotspotMapsSchema, validateImageHotspotTargets } from '../../src/modules/campaigns/image-hotspots.js';

const maps = [{
  imageUrl: 'https://example.org/menu.png',
  hotspots: [{ targetType: 'button' as const, targetKey: 'BTN_CLAIM', x: 100, y: 200, width: 300, height: 250 }],
}];
const buttons = [{ key: 'BTN_CLAIM', label: 'Claim', actionType: 'POSTBACK', actionValue: 'campaign:TEST:button:BTN_CLAIM', enabled: true }];

describe('campaign image hotspot plans', () => {
  it('validates bounded normalized areas and caps maps at four', () => {
    expect(imageHotspotMapsSchema.safeParse(maps).success).toBe(true);
    expect(imageHotspotMapsSchema.safeParse([{
      imageUrl: 'https://example.org/menu.png',
      hotspots: [{ targetType: 'button', targetKey: 'BTN_CLAIM', x: 900, y: 0, width: 200, height: 100 }],
    }]).success).toBe(false);
    expect(imageHotspotMapsSchema.safeParse(Array.from({ length: 5 }, () => maps[0])).success).toBe(false);
  });

  it('requires each hotspot to reference an enabled configured action', () => {
    expect(validateImageHotspotTargets(maps, buttons, [])).toEqual([]);
    expect(validateImageHotspotTargets(maps, [{ ...buttons[0]!, enabled: false }], []))
      .toEqual([expect.objectContaining({ message: expect.stringContaining('enabled button') })]);
  });

  it('exports coordinates together with the configured action identity', () => {
    expect(buildImageHotspotExport({ code: 'TEST', title: 'Test campaign' }, maps, buttons, [])).toEqual({
      format: 'ole88-image-hotspot-plan/v1',
      campaign: { code: 'TEST', title: 'Test campaign' },
      images: [{
        imageUrl: 'https://example.org/menu.png',
        hotspots: [{
          area: { x: 100, y: 200, width: 300, height: 250, coordinateScale: 1000 },
          target: { type: 'button', key: 'BTN_CLAIM', label: 'Claim', actionType: 'POSTBACK', actionValue: 'campaign:TEST:button:BTN_CLAIM' },
        }],
      }],
    });
  });
});
