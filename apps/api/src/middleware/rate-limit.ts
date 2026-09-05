import rateLimit from 'express-rate-limit';

// PRD §16.1 认证 / §16.2 输入验证：登录接口限流，防 brute force（口令爆破）
// TP-11 要求：/auth/login 5 次/分钟/IP
export const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分钟窗口
  limit: 5, // 每 IP 5 次
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'ERR0006',
      message: '登录尝试过于频繁，请 1 分钟后再试',
    },
  },
});
