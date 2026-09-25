import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { DomainError } from '../../domain/errors.js';

export type ImageMimeType = 'image/jpeg' | 'image/png';
export interface EvidenceStorage {
  put(key: string, mimeType: ImageMimeType, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class FileSystemEvidenceStorage implements EvidenceStorage {
  private readonly root: string;
  constructor(root: string) { this.root = resolve(root); }

  async put(key: string, _mimeType: ImageMimeType, data: Buffer) {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try {
      const handle = await open(path, 'wx', 0o600);
      try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    } catch (error) {
      if (!isCode(error, 'EEXIST')) throw error;
      const existing = await readFile(path);
      if (createHash('sha256').update(existing).digest('hex') !== createHash('sha256').update(data).digest('hex')) {
        throw new DomainError('Evidence storage key collision.', 'EVIDENCE_STORAGE_COLLISION');
      }
    }
  }

  read(key: string) { return readFile(this.pathFor(key)); }
  async delete(key: string) { await rm(this.pathFor(key), { force: true }); }

  private pathFor(key: string) {
    if (!/^[a-f0-9]{64}\.(jpg|png)$/.test(key)) throw new DomainError('Invalid evidence storage key.', 'INVALID_EVIDENCE_KEY');
    const path = resolve(this.root, key);
    if (!path.startsWith(`${this.root}${sep}`)) throw new DomainError('Invalid evidence storage path.', 'INVALID_EVIDENCE_KEY');
    return path;
  }
}

function isCode(error: unknown, code: string): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === code; }
