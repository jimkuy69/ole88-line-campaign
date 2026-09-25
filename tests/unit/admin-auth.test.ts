import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, sha256 } from '../../src/modules/admin/admin-auth-service.js';

describe('admin authentication primitives',()=>{
  it('stores scrypt password hashes and verifies without plaintext storage',async()=>{
    const password='A strong admin phrase! 2026';
    const encoded=await hashPassword(password);
    expect(encoded).toMatch(/^scrypt\$/);
    expect(encoded).not.toContain(password);
    await expect(verifyPassword(password,encoded)).resolves.toBe(true);
    await expect(verifyPassword('different password',encoded)).resolves.toBe(false);
    await expect(hashPassword('short')).rejects.toThrow('12 to 128');
  });
  it('produces deterministic hashes for opaque session token lookup',()=>{
    expect(sha256('opaque-token')).toBe(sha256('opaque-token'));
    expect(sha256('opaque-token')).not.toContain('opaque-token');
  });
});
