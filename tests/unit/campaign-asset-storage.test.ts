import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { CampaignAssetError, CampaignAssetStorage, CampaignAssetUploadGuard } from '../../src/modules/campaigns/campaign-asset-storage.js';

describe('campaign asset storage', () => {
  const directories: string[] = [];
  afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

  async function storage() {
    const directory = await mkdtemp(join(tmpdir(), 'ole88-campaign-assets-'));
    directories.push(directory);
    return { directory, storage: new CampaignAssetStorage(directory) };
  }

  async function png(width = 3, height = 2) {
    return sharp({ create: { width, height, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 1 } } }).png().toBuffer();
  }

  it('limits upload rate and concurrent image processing per application instance', () => {
    const guard = new CampaignAssetUploadGuard(2, 1_000, 1);
    const first = guard.acquire('admin-1', 0);
    expect(first?.retryAfterSeconds).toBe(0);
    expect(guard.acquire('admin-1', 1)?.retryAfterSeconds).toBe(5);
    if (!first?.release) throw new Error('Expected an upload permit.');
    first.release();
    first.release();
    const second = guard.acquire('admin-1', 2);
    expect(second?.retryAfterSeconds).toBe(0);
    if (!second?.release) throw new Error('Expected an upload permit.');
    second.release();
    expect(guard.acquire('admin-1', 3)?.retryAfterSeconds).toBe(1);
  });

  it('stores the verified original bytes, metadata, and an opaque id', async () => {
    const { directory, storage: assets } = await storage();
    const original = await png();
    const asset = await assets.put('../folder\\campaign.png', 'image/png', original);
    const saved = await assets.get(asset.assetId);
    expect(asset).toMatchObject({
      originalFilename: 'campaign.png', contentType: 'image/png', fileSizeBytes: original.length, width: 3, height: 2,
    });
    expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(saved.content).toEqual(original);
    expect(await readFile(join(directory, `${asset.assetId}.png`))).toEqual(original);
    expect((await assets.list()).map((item) => item.assetId)).toEqual([asset.assetId]);
  });

  it('rejects fake, mismatched, and unsupported image content', async () => {
    const { storage: assets } = await storage();
    await expect(assets.put('fake.png', 'image/png', Buffer.from('<html>'))).rejects.toMatchObject({
      code: 'INVALID_IMAGE', statusCode: 400,
    });
    await expect(assets.put('real.png', 'image/jpeg', await png())).rejects.toMatchObject({
      code: 'IMAGE_TYPE_MISMATCH', statusCode: 400,
    });
    await expect(assets.put('other.webp', 'image/webp', Buffer.from('x'))).rejects.toBeInstanceOf(CampaignAssetError);
  });

  it('rejects excessive upload size and decoded dimensions', async () => {
    const { storage: assets } = await storage();
    await expect(assets.put('large.png', 'image/png', Buffer.alloc(10 * 1024 * 1024 + 1))).rejects.toMatchObject({
      code: 'IMAGE_TOO_LARGE', statusCode: 413,
    });
    await expect(assets.put('wide.png', 'image/png', await png(4097, 1))).rejects.toMatchObject({
      code: 'IMAGE_DIMENSIONS_TOO_LARGE', statusCode: 400,
    });
  });

  it('does not resolve non-UUID paths and detects changed stored content', async () => {
    const { directory, storage: assets } = await storage();
    await expect(assets.get('../outside.png')).rejects.toMatchObject({ code: 'CAMPAIGN_ASSET_NOT_FOUND' });
    const asset = await assets.put('original.png', 'image/png', await png());
    await import('node:fs/promises').then(({ writeFile }) => writeFile(join(directory, `${asset.assetId}.png`), Buffer.from('changed')));
    await expect(assets.get(asset.assetId)).rejects.toMatchObject({ code: 'CAMPAIGN_ASSET_INTEGRITY_FAILURE' });
  });
});
