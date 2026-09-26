import 'dotenv/config';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  LINE_CHANNEL_SECRET: z.string().optional(),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().optional(),
  ADMIN_ONLY: z.preprocess((value) => value === 'true' ? true : value === 'false' ? false : value,
    z.boolean()).default(false),
  EVIDENCE_STORAGE_DIR: z.string().default('work/evidence'),
  CAMPAIGN_ASSET_STORAGE_DIR: z.string().default('work/campaign-assets'),
  EVIDENCE_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  PUBLIC_BASE_URL: z.preprocess((value) => value === '' ? undefined : value, z.string().url().optional()),
}).superRefine((config, context) => {
  if (config.NODE_ENV === 'production' && !config.PUBLIC_BASE_URL) {
    context.addIssue({ code: 'custom', path: ['PUBLIC_BASE_URL'], message: 'PUBLIC_BASE_URL is required in production mode.' });
  }
  if (config.NODE_ENV === 'production' && !isAbsolute(config.CAMPAIGN_ASSET_STORAGE_DIR)) {
    context.addIssue({ code: 'custom', path: ['CAMPAIGN_ASSET_STORAGE_DIR'], message: 'CAMPAIGN_ASSET_STORAGE_DIR must be an absolute persistent directory in production.' });
  }
  if (config.NODE_ENV === 'production' && isAbsolute(config.CAMPAIGN_ASSET_STORAGE_DIR)) {
    const fromWorkingDirectory = relative(process.cwd(), resolve(config.CAMPAIGN_ASSET_STORAGE_DIR));
    if (fromWorkingDirectory === '' || (fromWorkingDirectory !== '..' && !fromWorkingDirectory.startsWith(`..${sep}`))) {
      context.addIssue({ code: 'custom', path: ['CAMPAIGN_ASSET_STORAGE_DIR'], message: 'CAMPAIGN_ASSET_STORAGE_DIR must be outside the release working directory.' });
    }
  }
  if (config.PUBLIC_BASE_URL) {
    const url = new URL(config.PUBLIC_BASE_URL);
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      context.addIssue({ code: 'custom', path: ['PUBLIC_BASE_URL'], message: 'PUBLIC_BASE_URL must be an origin without a path, credentials, query, or fragment.' });
    }
    if (config.NODE_ENV === 'production' && url.protocol !== 'https:') {
      context.addIssue({ code: 'custom', path: ['PUBLIC_BASE_URL'], message: 'PUBLIC_BASE_URL must use HTTPS in production mode.' });
    }
  }
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = envSchema.parse(env);
  if (config.NODE_ENV === 'production' && !env.CAMPAIGN_ASSET_STORAGE_DIR) {
    throw new Error('CAMPAIGN_ASSET_STORAGE_DIR must point to a persistent directory outside the release directory in production.');
  }
  return config;
}
