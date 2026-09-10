import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3456),
  HOST: z.string().default('127.0.0.1'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DB_PATH: z.string().default('../qianqian-jzb.db'),
  // Fallback 默认值（测试 / 本地开发不依赖 .env）：
  // 生产环境 index.ts 通过 dotenv/config 注入真实值；切勿在生产依赖此默认值。
  JWT_SECRET: z.string().min(32).default('dev-only-insecure-jwt-secret-override-in-production'),
  DEEPSEEK_API_KEY: z.string().min(1).default('test-key'),
  DEEPSEEK_BASE_URL: z.string().default('https://api.deepseek.com'),
  DEEPSEEK_MODEL_FLASH: z.string().default('deepseek-flash'),
  DEEPSEEK_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  DEEPSEEK_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
  DB_PASSPHRASE: z.string().optional(),
  BACKUP_PASSPHRASE: z.string().optional(),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

export const config = schema.parse(process.env);
