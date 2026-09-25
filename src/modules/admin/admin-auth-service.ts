import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema.js';

const scrypt = promisify(scryptCb);
const SESSION_MS = 8 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const DUMMY_HASH = 'scrypt$MDEyMzQ1Njc4OWFiY2RlZg$uK1ToRpqRp5U8K5hC5nMbP6Mgc4HfNH1R1mFN6q2kgNmaEXx_N1Tjv7KxxTDpR2SybVMWYem62J0YFz-8nAGWA';

export const sha256 = (input: string) => createHash('sha256').update(input).digest('hex');

export async function hashPassword(password: string) {
  if (password.length < 12 || password.length > 128) throw new Error('Password must be 12 to 128 characters.');
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [, saltText, keyText] = encoded.split('$');
  if (!saltText || !keyText) return false;
  try {
    const expected = Buffer.from(keyText, 'base64url');
    const actual = await scrypt(password, Buffer.from(saltText, 'base64url'), expected.length) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}

type Db = NodePgDatabase<typeof schema>;
export class AdminAuthService {
  constructor(private readonly db: Db) {}

  async createFirstAdmin(username: string, password: string) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE ${schema.adminUsers} IN EXCLUSIVE MODE`);
      const [existing] = await tx.select({ id: schema.adminUsers.id }).from(schema.adminUsers).limit(1);
      if (existing) throw Object.assign(new Error('An admin account already exists.'), { code: 'ADMIN_ALREADY_EXISTS' });
      const [user] = await tx.insert(schema.adminUsers).values({ username: username.trim().toLowerCase(), passwordHash: await hashPassword(password) }).returning();
      return user!;
    });
  }

  async login(username: string, password: string, ip: string) {
    const now = new Date();
    const keyHash = sha256(ip || 'unknown');
    const [attempt] = await this.db.select().from(schema.adminLoginAttempts).where(eq(schema.adminLoginAttempts.keyHash, keyHash)).limit(1);
    if (attempt?.lockedUntil && attempt.lockedUntil > now) return null;
    const [user] = await this.db.select().from(schema.adminUsers).where(eq(schema.adminUsers.username, username.trim().toLowerCase())).limit(1);
    const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || user.disabledAt || !valid) {
      await this.db.insert(schema.adminLoginAttempts).values({ keyHash, failures: 1, windowStartedAt: now })
        .onConflictDoUpdate({ target: schema.adminLoginAttempts.keyHash, set: {
          failures: sql`CASE WHEN ${schema.adminLoginAttempts.windowStartedAt} < ${new Date(now.getTime() - WINDOW_MS)} THEN 1 ELSE ${schema.adminLoginAttempts.failures} + 1 END`,
          windowStartedAt: sql`CASE WHEN ${schema.adminLoginAttempts.windowStartedAt} < ${new Date(now.getTime() - WINDOW_MS)} THEN ${now} ELSE ${schema.adminLoginAttempts.windowStartedAt} END`,
          lockedUntil: sql`CASE WHEN ${schema.adminLoginAttempts.failures} >= ${MAX_FAILURES - 1} THEN ${new Date(now.getTime() + WINDOW_MS)}::timestamptz ELSE NULL END`,
        } });
      return null;
    }
    await this.db.delete(schema.adminLoginAttempts).where(eq(schema.adminLoginAttempts.keyHash, keyHash));
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + SESSION_MS);
    await this.db.insert(schema.adminSessions).values({ adminUserId: user.id, tokenHash: sha256(token), csrfToken, expiresAt });
    return { token, csrfToken, expiresAt, user: { id: user.id, username: user.username } };
  }

  async getSession(token: string | undefined) {
    if (!token) return null;
    const [row] = await this.db.select({ session: schema.adminSessions, user: { id: schema.adminUsers.id, username: schema.adminUsers.username } })
      .from(schema.adminSessions).innerJoin(schema.adminUsers, eq(schema.adminUsers.id, schema.adminSessions.adminUserId))
      .where(and(eq(schema.adminSessions.tokenHash, sha256(token)), gt(schema.adminSessions.expiresAt, new Date()), sql`${schema.adminUsers.disabledAt} IS NULL`)).limit(1);
    return row ?? null;
  }

  async logout(token: string | undefined) {
    if (token) await this.db.delete(schema.adminSessions).where(eq(schema.adminSessions.tokenHash, sha256(token)));
  }
}
