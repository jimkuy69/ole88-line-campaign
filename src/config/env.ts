import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  LINE_CHANNEL_SECRET: z.string().optional(),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().optional(),
  EVIDENCE_STORAGE_DIR: z.string().default('work/evidence'),
  EVIDENCE_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  PUBLIC_BASE_URL: z.preprocess((value) => value === '' ? undefined : value, z.string().url().optional()),
}).superRefine((config, context) => {
  if (config.NODE_ENV === 'production' && !config.PUBLIC_BASE_URL) {
    context.addIssue({ code: 'custom', path: ['PUBLIC_BASE_URL'], message: 'PUBLIC_BASE_URL is required in production mode.' });
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
  return envSchema.parse(env);
}
