import { CAMPAIGN_ACTION_REGISTRY, campaignActionSupport } from './action-registry.js';
import { imageHotspotMapsSchema, validateImageHotspotTargets } from './image-hotspots.js';
import type { CampaignDraft } from '../admin/templates.js';
import { CampaignAssetError, type CampaignAsset, type CampaignAssetStorage } from './campaign-asset-storage.js';

const OVERLAP_WARNING = 'Overlapping touch areas may make the intended target ambiguous.';

export async function validateAndBuildCampaignImagePlan(
  draft: CampaignDraft,
  campaignVersion: number,
  publicBaseUrl: string,
  storage: CampaignAssetStorage,
) {
  const blockers: Array<{ path: string; message: string; selector: string }> = [];
  const warnings: Array<{ path: string; message: string }> = [];
  const parsed = imageHotspotMapsSchema.safeParse(draft.campaign.settings.imageHotspots);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = ['campaign', 'settings', 'imageHotspots', ...issue.path.filter(
        (part): part is string | number => typeof part === 'string' || typeof part === 'number',
      )];
      blockers.push({ path: path.join('.'), message: issue.message, selector: selectorForPath(path) });
    }
    return { validation: { status: 'blocked' as const, blockers, warnings } };
  }
  if (!parsed.data.length) {
    blockers.push({ path: 'campaign.settings.imageHotspots', message: 'Add at least one valid uploaded image.', selector: '.hotspot-planner' });
    return { validation: { status: 'blocked' as const, blockers, warnings } };
  }

  const maps = parsed.data;
  const targets = [
    ...draft.buttons.map((item) => ({ type: 'button' as const, key: item.buttonKey, label: item.label, actionType: item.actionType, actionValue: item.actionValue, enabled: item.enabled })),
    ...draft.activities.map((item) => ({ type: 'activity' as const, key: item.activityKey, label: item.title, actionType: item.actionType, actionValue: item.actionValue, enabled: item.enabled })),
  ];

  for (const issue of validateImageHotspotTargets(maps, draft.buttons.map((item) => ({
    key: item.buttonKey, label: item.label, actionType: item.actionType, actionValue: item.actionValue, enabled: item.enabled,
  })), draft.activities.map((item) => ({
    key: item.activityKey, label: item.title, actionType: item.actionType, actionValue: item.actionValue, enabled: item.enabled,
  })))) {
    const path = issue.path.join('.');
    blockers.push({ path, message: issue.message, selector: selectorForPath(issue.path) });
  }

  const imageAssets: Array<{ asset: CampaignAsset; imageUrl: string; hotspots: unknown[] }> = [];
  for (const [mapIndex, map] of maps.entries()) {
    const mapPath = `campaign.settings.imageHotspots.${mapIndex}`;
    const mapSelector = `.hotspot-map[data-map-index="${mapIndex}"]`;
    if (!map.assetId || !map.metadata) {
      blockers.push({ path: `${mapPath}.assetId`, message: 'Upload and verify this image in Campaign Image Planner.', selector: mapSelector });
      continue;
    }
    const expectedUrl = new URL(`/campaign-assets/${map.assetId}`, publicBaseUrl).toString();
    if (map.imageUrl !== expectedUrl) {
      blockers.push({ path: `${mapPath}.imageUrl`, message: 'Image URL does not match the verified uploaded asset.', selector: mapSelector });
      continue;
    }
    let verified: { asset: CampaignAsset; content: Buffer };
    try {
      verified = await storage.get(map.assetId);
    } catch (error) {
      if (!(error instanceof CampaignAssetError)
        || (error.code !== 'CAMPAIGN_ASSET_NOT_FOUND' && error.code !== 'CAMPAIGN_ASSET_INTEGRITY_FAILURE')) throw error;
      blockers.push({ path: `${mapPath}.assetId`, message: 'Uploaded image is missing or failed its integrity check.', selector: mapSelector });
      continue;
    }
    if (!matchesStoredMetadata(map.metadata, verified.asset)) {
      blockers.push({ path: `${mapPath}.metadata`, message: 'Image metadata does not match the stored original.', selector: mapSelector });
      continue;
    }
    if (!map.hotspots.length) blockers.push({ path: `${mapPath}.hotspots`, message: 'Add at least one touch area to this image.', selector: mapSelector });

    map.hotspots.forEach((hotspot, hotspotIndex) => {
      const path = `${mapPath}.hotspots.${hotspotIndex}`;
      if (hotspot.width <= 0 || hotspot.height <= 0
        || hotspot.x + hotspot.width > 1000 || hotspot.y + hotspot.height > 1000) {
        blockers.push({ path, message: 'Touch area must have positive size and remain within the image bounds.', selector: selectorForPath(['campaign', 'settings', 'imageHotspots', mapIndex, 'hotspots', hotspotIndex]) });
      }
      if (!hotspot.id) {
        blockers.push({ path: `${path}.id`, message: 'This touch area needs a stable ID. Reload it in Campaign Image Planner and save the draft before export.', selector: selectorForPath(['campaign', 'settings', 'imageHotspots', mapIndex, 'hotspots', hotspotIndex]) });
      }
      const target = targets.find((item) => item.type === hotspot.targetType && item.key === hotspot.targetKey);
      if (!target) {
        blockers.push({ path: `${path}.targetKey`, message: 'Selected button or activity does not exist.', selector: selectorForPath(['campaign', 'settings', 'imageHotspots', mapIndex, 'hotspots', hotspotIndex]) });
      } else {
        if (!target.enabled) blockers.push({ path: `${path}.targetKey`, message: 'Selected button or activity is disabled.', selector: selectorForPath(['campaign', 'settings', 'imageHotspots', mapIndex, 'hotspots', hotspotIndex]) });
        if (!target.label.trim()) blockers.push({ path: `${path}.targetKey`, message: 'Selected target needs a label.', selector: selectorForPath(['campaign', 'settings', 'imageHotspots', mapIndex, 'hotspots', hotspotIndex]) });
        const support = campaignActionSupport(target, draft.campaign.code);
        if (!support.supported) blockers.push({ path: `${path}.targetKey`, message: `Unsupported target action: ${support.reason}`, selector: selectorForPath(['campaign', 'settings', 'imageHotspots', mapIndex, 'hotspots', hotspotIndex]) });
        if (!target.actionValue?.trim()) blockers.push({ path: `${path}.targetKey`, message: 'Selected target has no action value.', selector: selectorForPath(['campaign', 'settings', 'imageHotspots', mapIndex, 'hotspots', hotspotIndex]) });
      }
      for (const other of map.hotspots.slice(0, hotspotIndex)) {
        const overlaps = hotspot.x < other.x + other.width && hotspot.x + hotspot.width > other.x
          && hotspot.y < other.y + other.height && hotspot.y + hotspot.height > other.y;
        if (overlaps) {
          warnings.push({ path, message: OVERLAP_WARNING });
          break;
        }
      }
    });

    imageAssets.push({
      asset: verified.asset,
      imageUrl: map.imageUrl,
      hotspots: map.hotspots.map((hotspot) => {
        const target = targets.find((item) => item.type === hotspot.targetType && item.key === hotspot.targetKey);
        const action = target ? campaignActionSupport(target, draft.campaign.code) : { supported: false, reason: 'Target is missing.' };
        const pixelLeft = Math.floor((hotspot.x * verified.asset.width) / 1000);
        const pixelTop = Math.floor((hotspot.y * verified.asset.height) / 1000);
        const pixelRight = Math.ceil(((hotspot.x + hotspot.width) * verified.asset.width) / 1000);
        const pixelBottom = Math.ceil(((hotspot.y + hotspot.height) * verified.asset.height) / 1000);
        return {
          id: hotspot.id ?? null,
          imageAssetId: map.assetId,
          area: {
            x: hotspot.x, y: hotspot.y, width: hotspot.width, height: hotspot.height,
            coordinateSystem: 'normalized-image-plane',
            units: 'integer-thousandths-of-image-width-and-height',
            scale: 1000,
            origin: 'top-left',
          },
          pixelArea: {
            x: pixelLeft, y: pixelTop, width: pixelRight - pixelLeft, height: pixelBottom - pixelTop,
            units: 'pixels',
            rounding: 'floor-left-top-ceil-right-bottom',
          },
          target: target ? {
            type: hotspot.targetType,
            id: hotspot.targetKey,
            label: target.label,
            actionType: target.actionType,
            actionValue: target.actionValue,
            enabled: target.enabled,
            runtimeSupported: action.supported,
            runtimeSupportReason: action.reason,
          } : {
            type: hotspot.targetType, id: hotspot.targetKey, label: null, actionType: null, actionValue: null, enabled: false,
            runtimeSupported: false, runtimeSupportReason: action.reason,
          },
        };
      }),
    });
  }

  if (blockers.length) return { validation: { status: 'blocked' as const, blockers, warnings } };
  const plan = {
    schemaVersion: 'ole88.campaign-image-handoff/2.0.0',
    actionRegistryVersion: CAMPAIGN_ACTION_REGISTRY.version,
    handoffType: 'OLE88_INTERNAL_TEAM_PLANNING',
    generatedAt: new Date().toISOString(),
    usageNotice: 'Planning handoff only. Not a LINE message, LINE Imagemap payload, publishable campaign, or proof that hotspots work in LINE.',
    campaign: { code: draft.campaign.code, title: draft.campaign.title, name: draft.campaign.name, version: campaignVersion },
    imageAttachments: imageAssets.map(({ asset, imageUrl }) => ({
      assetId: asset.assetId, url: imageUrl, originalFilename: asset.originalFilename,
      contentType: asset.contentType, fileSizeBytes: asset.fileSizeBytes, width: asset.width,
      height: asset.height, sha256: asset.sha256,
      instruction: 'The JSON references this image; attach or open the image separately for visual review. The binary image is not embedded in this JSON.',
    })),
    images: imageAssets.map(({ asset, imageUrl, hotspots }) => ({
      assetId: asset.assetId, imageUrl, originalFilename: asset.originalFilename, contentType: asset.contentType,
      fileSizeBytes: asset.fileSizeBytes, pixelDimensions: { width: asset.width, height: asset.height },
      sha256: asset.sha256, hotspots,
    })),
    validation: {
      status: 'ready',
      blockerCount: 0,
      warningCount: warnings.length,
      checkedRules: [
        'Uploaded JPEG/PNG asset integrity, metadata, and asset URL',
        'Image count, hotspot geometry, and hotspot ID uniqueness',
        'Enabled target existence and supported action configuration',
      ],
      warnings,
      notChecked: [
        'Remote HTTPS reachability at the time this plan is reviewed',
        'LINE platform acceptance or actual message delivery',
        'Visual accessibility, artwork legibility, and real-device tap usability',
      ],
    },
  };
  const prompt = [
    'คุณกำลังช่วยทีม OLE88 ทำงานต่อจาก Campaign Image Planner',
    'ใช้เฉพาะข้อมูลและพิกัดที่ระบุใน JSON ด้านล่าง ห้ามเดา URL, พิกัด, action, ข้อความ หรือความสามารถของ LINE ที่ไม่มีอยู่ในข้อมูล',
    'JSON นี้เป็นแผนส่งต่อภายในทีมเท่านั้น ไม่ใช่ LINE message, LINE Imagemap ที่พร้อมใช้งาน, หรือแคมเปญที่ publish แล้ว และไม่ได้ทำให้ hotspot กดได้จริงใน LINE',
    'ไฟล์ JSON ไม่ได้ฝังข้อมูลภาพ ให้เปิดหรือแนบไฟล์ต้นฉบับแต่ละภาพจาก imageAttachments แยกต่างหากก่อนวิเคราะห์ หากไม่มีภาพให้ระบุว่าไม่สามารถตรวจภาพได้',
    `Campaign: ${plan.campaign.code} · ${plan.campaign.title || plan.campaign.name} · Draft version ${campaignVersion}`,
    `Images and hotspots: ${JSON.stringify(plan.images)}`,
    `Warnings: ${JSON.stringify(warnings)}`,
    'ก่อนเสนอการนำไปใช้งานจริง ให้แยกสิ่งที่ยืนยันจากข้อมูลออกจากข้อเสนอเพิ่มเติม และระบุข้อจำกัดที่ยังต้องให้ทีมตรวจสอบ',
  ].join('\n\n');
  return { validation: { status: 'ready' as const, blockers, warnings }, plan, prompt };
}

function matchesStoredMetadata(metadata: NonNullable<ReturnType<typeof imageHotspotMapsSchema.parse>[number]['metadata']>, asset: CampaignAsset) {
  return metadata.originalFilename === asset.originalFilename && metadata.contentType === asset.contentType
    && metadata.fileSizeBytes === asset.fileSizeBytes && metadata.width === asset.width
    && metadata.height === asset.height && metadata.sha256 === asset.sha256;
}

export function selectorForPath(path: Array<string | number>) {
  const mapsIndex = path.indexOf('imageHotspots');
  if (mapsIndex >= 0 && typeof path[mapsIndex + 1] === 'number') {
    const mapSelector = `.hotspot-map[data-map-index="${path[mapsIndex + 1]}"]`;
    const areaIndex = path.indexOf('hotspots', mapsIndex + 2);
    return areaIndex >= 0 && typeof path[areaIndex + 1] === 'number'
      ? `${mapSelector} .hotspot-area-list li:nth-child(${Number(path[areaIndex + 1]) + 1})`
      : mapSelector;
  }
  const group = path.find((part) => part === 'buttons' || part === 'activities' || part === 'messages');
  if (group === 'buttons') return '#buttons';
  if (group === 'activities') return '#activities';
  if (group === 'messages') return '#messages';
  const field = path.at(-1);
  if (typeof field === 'string' && ['code', 'name', 'title', 'subtitle', 'heroImage'].includes(field)) return `#${field}`;
  return '.hotspot-planner';
}
