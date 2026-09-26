import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import sharp, { type Metadata } from 'sharp';

export const CAMPAIGN_ASSET_MAX_BYTES = 10 * 1024 * 1024;
export const CAMPAIGN_ASSET_MAX_DIMENSION = 4096;
export const CAMPAIGN_ASSET_MAX_PIXELS = 16_000_000;
export const CAMPAIGN_ASSET_UPLOADS_PER_HOUR = 20;
export const CAMPAIGN_ASSET_MAX_CONCURRENT_UPLOADS = 2;

const assetIdSchema = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CampaignAsset {
  assetId: string;
  originalFilename: string;
  contentType: 'image/jpeg' | 'image/png';
  fileSizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  uploadedAt: string;
}

export class CampaignAssetError extends Error {
  constructor(message: string, readonly code: string, readonly statusCode: number) {
    super(message);
    this.name = 'CampaignAssetError';
  }
}

export class CampaignAssetUploadGuard {
  private readonly attempts = new Map<string, number[]>();
  private activeUploads = 0;

  constructor(
    private readonly maxPerWindow = CAMPAIGN_ASSET_UPLOADS_PER_HOUR,
    private readonly windowMs = 60 * 60 * 1000,
    private readonly maxConcurrent = CAMPAIGN_ASSET_MAX_CONCURRENT_UPLOADS,
  ) {}

  acquire(adminId: string, now = Date.now()): { release?: () => void; retryAfterSeconds: number } {
    const cutoff = now - this.windowMs;
    const recent = (this.attempts.get(adminId) ?? []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= this.maxPerWindow) {
      this.attempts.set(adminId, recent);
      return { retryAfterSeconds: Math.max(1, Math.ceil((recent[0]! + this.windowMs - now) / 1000)) };
    }
    if (this.activeUploads >= this.maxConcurrent) {
      return { retryAfterSeconds: 5 };
    }

    recent.push(now);
    this.attempts.set(adminId, recent);
    this.activeUploads += 1;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.activeUploads -= 1;
      },
      retryAfterSeconds: 0,
    };
  }
}

export class CampaignAssetStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(filename: string, contentType: string, input: Buffer): Promise<CampaignAsset> {
    if (input.length === 0) throw new CampaignAssetError('The uploaded image is empty.', 'EMPTY_IMAGE', 400);
    if (input.length > CAMPAIGN_ASSET_MAX_BYTES) {
      throw new CampaignAssetError('Images must be 10 MiB or smaller.', 'IMAGE_TOO_LARGE', 413);
    }
    if (contentType !== 'image/jpeg' && contentType !== 'image/png') {
      throw new CampaignAssetError('Only JPEG and PNG images are accepted.', 'UNSUPPORTED_IMAGE_TYPE', 415);
    }

    let metadata: Metadata;
    try {
      const image = sharp(input, { failOn: 'error', limitInputPixels: CAMPAIGN_ASSET_MAX_PIXELS });
      metadata = await image.metadata();
      if (metadata.format !== (contentType === 'image/jpeg' ? 'jpeg' : 'png')) {
        throw new CampaignAssetError('The file content does not match its image type.', 'IMAGE_TYPE_MISMATCH', 400);
      }
      if ((metadata.pages ?? 1) !== 1) {
        throw new CampaignAssetError('Animated or multi-page images are not supported.', 'MULTIPAGE_IMAGE', 400);
      }
      if (!metadata.width || !metadata.height || metadata.width > CAMPAIGN_ASSET_MAX_DIMENSION
        || metadata.height > CAMPAIGN_ASSET_MAX_DIMENSION || metadata.width * metadata.height > CAMPAIGN_ASSET_MAX_PIXELS) {
        throw new CampaignAssetError('Images must be at most 4096 × 4096 pixels and 16 megapixels.', 'IMAGE_DIMENSIONS_TOO_LARGE', 400);
      }
      await image.stats();
    } catch (error) {
      if (error instanceof CampaignAssetError) throw error;
      throw new CampaignAssetError('The uploaded file is not a valid, fully decodable JPEG or PNG image.', 'INVALID_IMAGE', 400);
    }

    const assetId = randomUUID();
    const extension = contentType === 'image/jpeg' ? '.jpg' : '.png';
    const imagePath = this.assetPath(assetId, extension);
    const metadataPath = this.metadataPath(assetId);
    const imageTempPath = this.tempPath(assetId, 'image');
    const metadataTempPath = this.tempPath(assetId, 'metadata');
    const asset: CampaignAsset = {
      assetId,
      originalFilename: safeFilename(filename),
      contentType,
      fileSizeBytes: input.length,
      width: metadata.width!,
      height: metadata.height!,
      sha256: createHash('sha256').update(input).digest('hex'),
      uploadedAt: new Date().toISOString(),
    };

    await mkdir(this.root, { recursive: true, mode: 0o700 });
    try {
      await writeFile(imageTempPath, input, { flag: 'wx', mode: 0o600 });
      await writeFile(metadataTempPath, JSON.stringify(asset), { flag: 'wx', mode: 0o600 });
      await rename(imageTempPath, imagePath);
      await rename(metadataTempPath, metadataPath);
      return asset;
    } catch (error) {
      await Promise.all([
        rm(imageTempPath, { force: true }),
        rm(metadataTempPath, { force: true }),
        rm(imagePath, { force: true }),
        rm(metadataPath, { force: true }),
      ]);
      throw error;
    }
  }

  async get(assetId: string): Promise<{ asset: CampaignAsset; content: Buffer }> {
    if (!assetIdSchema.test(assetId)) {
      throw new CampaignAssetError('Campaign image not found.', 'CAMPAIGN_ASSET_NOT_FOUND', 404);
    }
    try {
      const asset = parseAsset(await readFile(this.metadataPath(assetId), 'utf8'));
      const extension = asset.contentType === 'image/jpeg' ? '.jpg' : '.png';
      const content = await readFile(this.assetPath(assetId, extension));
      if (createHash('sha256').update(content).digest('hex') !== asset.sha256) {
        throw new CampaignAssetError('Stored campaign image failed its integrity check.', 'CAMPAIGN_ASSET_INTEGRITY_FAILURE', 500);
      }
      return { asset, content };
    } catch (error) {
      if (error instanceof CampaignAssetError) throw error;
      if (isCode(error, 'ENOENT')) throw new CampaignAssetError('Campaign image not found.', 'CAMPAIGN_ASSET_NOT_FOUND', 404);
      throw error;
    }
  }

  async list(): Promise<CampaignAsset[]> {
    const { readdir } = await import('node:fs/promises');
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch (error) {
      if (isCode(error, 'ENOENT')) return [];
      throw error;
    }
    const sidecars = names.filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name));
    return Promise.all(sidecars.map(async (name) => parseAsset(await readFile(resolve(this.root, name), 'utf8'))));
  }

  private assetPath(assetId: string, extension: string) {
    if (!assetIdSchema.test(assetId) || (extension !== '.jpg' && extension !== '.png')) {
      throw new CampaignAssetError('Campaign image not found.', 'CAMPAIGN_ASSET_NOT_FOUND', 404);
    }
    return resolve(this.root, `${assetId}${extension}`);
  }

  private metadataPath(assetId: string) {
    if (!assetIdSchema.test(assetId)) throw new CampaignAssetError('Campaign image not found.', 'CAMPAIGN_ASSET_NOT_FOUND', 404);
    return resolve(this.root, `${assetId}.json`);
  }

  private tempPath(assetId: string, suffix: string) {
    return resolve(this.root, `.${assetId}.${suffix}.tmp`);
  }
}

function parseAsset(value: string): CampaignAsset {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object') throw new Error('Campaign asset metadata is invalid.');
  const asset = parsed as Partial<CampaignAsset>;
  if (typeof asset.assetId !== 'string' || !assetIdSchema.test(asset.assetId)
    || typeof asset.originalFilename !== 'string'
    || (asset.contentType !== 'image/jpeg' && asset.contentType !== 'image/png')
    || !Number.isSafeInteger(asset.fileSizeBytes) || (asset.fileSizeBytes ?? 0) <= 0
    || !Number.isSafeInteger(asset.width) || (asset.width ?? 0) <= 0
    || !Number.isSafeInteger(asset.height) || (asset.height ?? 0) <= 0
    || typeof asset.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(asset.sha256)
    || typeof asset.uploadedAt !== 'string') {
    throw new Error('Campaign asset metadata is invalid.');
  }
  return asset as CampaignAsset;
}

function safeFilename(value: string): string {
  const name = basename(value.replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (name || 'campaign-image').slice(0, 255);
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
