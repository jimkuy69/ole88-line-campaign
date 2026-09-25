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
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  return envSchema.parse(env);
}
