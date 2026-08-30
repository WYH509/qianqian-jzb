import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3456),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DB_PATH: z.string().default('../qianqian-jzb.db'),
  JWT_SECRET: z.string().min(32),
  DEEPSEEK_API_KEY: z.string().min(1),
  DEEPSEEK_MODEL_FLASH: z.string().default('deepseek-v4-flash'),
  DEEPSEEK_MODEL_PRO: z.string().default('deepseek-v4-pro'),
  DB_PASSPHRASE: z.string().optional(),
  BACKUP_PASSPHRASE: z.string().optional(),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

export const config = schema.parse(process.env);
