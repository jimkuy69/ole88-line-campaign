import { describe, expect, it } from 'vitest';
import { imageHotspotMapsSchema, validateImageHotspotTargets } from '../../src/modules/campaigns/image-hotspots.js';
import { campaignButtonPostback } from '../../src/modules/campaigns/postback-data.js';
import { CAMPAIGN_ACTION_REGISTRY, campaignActionSupport } from '../../src/modules/campaigns/action-registry.js';
import { CampaignAssetStorage } from '../../src/modules/campaigns/campaign-asset-storage.js';
import { validateAndBuildCampaignImagePlan } from '../../src/modules/campaigns/campaign-image-plan.js';
import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEMPLATES } from '../../src/modules/admin/templates.js';

const maps = [{
  imageUrl: 'https://example.org/menu.png',
  hotspots: [{ targetType: 'button' as const, targetKey: 'BTN_CLAIM', x: 100, y: 200, width: 300, height: 250 }],
}];
const buttons = [{ key: 'BTN_CLAIM', label: 'Claim', actionType: 'POSTBACK', actionValue: 'campaign:TEST:button:BTN_CLAIM', enabled: true }];

describe('campaign image hotspot plans', () => {
  it('reports only current runtime-supported URI and claim actions', () => {
    expect(CAMPAIGN_ACTION_REGISTRY.version).toBe(1);
    expect(campaignActionSupport({
      type: 'activity', key: 'ACTIVITY_1', actionType: 'URI', actionValue: 'https://example.org/page',
    }, 'PLAN_TEST')).toMatchObject({ supported: true, reason: null });
    expect(campaignActionSupport({
      type: 'activity', key: 'ACTIVITY_1', actionType: 'URI', actionValue: `https://example.org/${'a'.repeat(1000)}`,
    }, 'PLAN_TEST')).toMatchObject({ supported: false });
    expect(campaignActionSupport({
      type: 'button', key: 'BTN_OTHER', actionType: 'POSTBACK', actionValue: 'any-data',
    }, 'PLAN_TEST')).toMatchObject({ supported: false });
  });

  it('validates bounded normalized areas and caps maps at four', () => {
    expect(imageHotspotMapsSchema.safeParse(maps).success).toBe(true);
    expect(imageHotspotMapsSchema.safeParse([{
      imageUrl: 'https://example.org/menu.png',
      hotspots: [{ targetType: 'button', targetKey: 'BTN_CLAIM', x: 0, y: 0, width: 1, height: 1 }],
    }]).success).toBe(true);
    expect(imageHotspotMapsSchema.safeParse([{
      imageUrl: 'https://example.org/menu.png',
      hotspots: [{ targetType: 'button', targetKey: 'BTN_CLAIM', x: 10, y: 10, width: 0, height: 1 }],
    }]).success).toBe(false);
    expect(imageHotspotMapsSchema.safeParse([{
      imageUrl: 'https://example.org/menu.png',
      hotspots: [{ targetType: 'button', targetKey: 'BTN_CLAIM', x: 900, y: 0, width: 200, height: 100 }],
    }]).success).toBe(false);
    expect(imageHotspotMapsSchema.safeParse(Array.from({ length: 5 }, () => maps[0])).success).toBe(false);
  });

  it('rejects duplicate uploaded asset and stable hotspot IDs', () => {
    const assetId = 'c139f9a1-93bd-4a1f-929e-e76309a19067';
    const hotspotId = '8b91c7f6-108e-4ec0-bcb1-5f0c7320a6f7';
    const repeated = {
      assetId,
      imageUrl: `https://example.org/campaign-assets/${assetId}`,
      hotspots: [{ id: hotspotId, targetType: 'button' as const, targetKey: 'BTN_CLAIM', x: 0, y: 0, width: 50, height: 50 }],
    };
    expect(imageHotspotMapsSchema.safeParse([repeated, repeated]).success).toBe(false);
    expect(imageHotspotMapsSchema.safeParse([
      repeated,
      { ...repeated, assetId: 'e62a58a4-1487-4621-a9e3-b4ce8da05a24' },
    ]).success).toBe(false);
  });

  it('requires each hotspot to reference an enabled configured action', () => {
    expect(validateImageHotspotTargets(maps, buttons, [])).toEqual([]);
    expect(validateImageHotspotTargets(maps, [{ ...buttons[0]!, enabled: false }], []))
      .toEqual([expect.objectContaining({ message: expect.stringContaining('enabled button') })]);
  });

  it('builds a versioned internal handoff only after verifying the uploaded image and supported target', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'ole88-image-plan-'));
      try {
        const storage = new CampaignAssetStorage(directory);
        const image = await sharp({ create: { width: 20, height: 10, channels: 3, background: 'white' } }).png().toBuffer();
        const asset = await storage.put('poster.png', 'image/png', image);
        const draft = structuredClone(TEMPLATES[0]!.draft);
        draft.campaign.code = 'PLAN_TEST';
        draft.buttons[0]!.actionValue = campaignButtonPostback('PLAN_TEST', 'BTN_CLAIM');
        draft.campaign.settings.imageHotspots = [{
          assetId: asset.assetId,
          imageUrl: `https://campaign.example/campaign-assets/${asset.assetId}`,
          metadata: {
            originalFilename: asset.originalFilename, contentType: asset.contentType, fileSizeBytes: asset.fileSizeBytes,
            width: asset.width, height: asset.height, sha256: asset.sha256,
          },
          hotspots: [{ id: '8b91c7f6-108e-4ec0-bcb1-5f0c7320a6f7', targetType: 'button', targetKey: 'BTN_CLAIM', x: 100, y: 100, width: 250, height: 200 }],
        }];

        const result = await validateAndBuildCampaignImagePlan(draft, 7, 'https://campaign.example', storage);
        expect(result.validation).toMatchObject({ status: 'ready', blockers: [], warnings: [] });
        expect(result.plan).toMatchObject({
          schemaVersion: 'ole88.campaign-image-handoff/2.0.0',
          actionRegistryVersion: 1,
          handoffType: 'OLE88_INTERNAL_TEAM_PLANNING',
          campaign: { code: 'PLAN_TEST', version: 7 },
          images: [{
            pixelDimensions: { width: 20, height: 10 },
            hotspots: [{
              area: { x: 100, y: 100, width: 250, height: 200, scale: 1000, origin: 'top-left' },
              pixelArea: { x: 2, y: 1, width: 5, height: 2, units: 'pixels', rounding: 'floor-left-top-ceil-right-bottom' },
              id: '8b91c7f6-108e-4ec0-bcb1-5f0c7320a6f7',
              target: { type: 'button', id: 'BTN_CLAIM', actionType: 'POSTBACK', enabled: true },
            }],
          }],
        });
        expect(result.plan?.validation).toMatchObject({
          checkedRules: expect.arrayContaining(['Uploaded JPEG/PNG asset integrity, metadata, and asset URL']),
          notChecked: expect.arrayContaining(['LINE platform acceptance or actual message delivery']),
        });
        expect(result.prompt).toContain('ไม่ใช่ LINE message');
        expect(result.prompt).toContain('ห้ามเดา URL');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
  });

  it('blocks zero coordinates and configured actions the current webhook does not process', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'ole88-image-plan-blocked-'));
      try {
        const storage = new CampaignAssetStorage(directory);
        const image = await sharp({ create: { width: 20, height: 10, channels: 3, background: 'white' } }).png().toBuffer();
        const asset = await storage.put('poster.png', 'image/png', image);
        const draft = structuredClone(TEMPLATES[0]!.draft);
        draft.campaign.code = 'PLAN_TEST';
        draft.buttons[0]!.actionValue = 'unhandled-postback';
        draft.campaign.settings.imageHotspots = [{
          assetId: asset.assetId,
          imageUrl: `https://campaign.example/campaign-assets/${asset.assetId}`,
          metadata: {
            originalFilename: asset.originalFilename, contentType: asset.contentType, fileSizeBytes: asset.fileSizeBytes,
            width: asset.width, height: asset.height, sha256: asset.sha256,
          },
          hotspots: [{ id: '8b91c7f6-108e-4ec0-bcb1-5f0c7320a6f7', targetType: 'button', targetKey: 'BTN_CLAIM', x: 0, y: 10, width: 250, height: 200 }],
        }];

        const result = await validateAndBuildCampaignImagePlan(draft, 1, 'https://campaign.example', storage);
        expect(result.validation.status).toBe('blocked');
        if (result.validation.status !== 'blocked') throw new Error('Expected the image plan to be blocked.');
        expect(result.validation.blockers.map((item) => item.message)).toEqual(expect.arrayContaining([
          expect.stringContaining('Unsupported target action'),
        ]));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
  });
});
