import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { writeAudit } from '../utils/audit.js';

// TP-11 P1#3：double-submit cookie 模式 CSRF 防护
// - ensureCsrfCookie：GET 请求时先种好 csrf cookie（前端 JS 可读，httpOnly=false）
// - verifyCsrf：非安全方法（POST/PUT/DELETE/PATCH）必须 X-CSRF-Token header === csrf cookie
// 豁免：GET/HEAD/OPTIONS（SAFE_METHODS），以及 login / internal/process-queue（由挂载顺序在 verifyCsrf 之前处理）
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE = 'csrf';

export function ensureCsrfCookie(req: Request, res: Response, next: NextFunction): void {
  // 确保 cookie 存在（GET 请求时也种好）
  if (!req.cookies?.[CSRF_COOKIE]) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false, // 关键：前端 JS 要读
      sameSite: 'strict',
      // 用 req.secure 判断（不是 NODE_ENV）— 后端 launchd plist 设了 NODE_ENV=production，
      // 但本机实际是 HTTP，prod 假设导致 Secure=true → 浏览器非 HTTPS 不发 cookie → CSRF 验证失败
      secure: req.secure,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }
  next();
}

export function verifyCsrf(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    writeAudit({
      action: 'update', // 跨方法不准确但 trigger 审计足够
      userId: req.user?.userId ?? 'unknown',
      errorCategory: 'csrf_mismatch',
      details: `method=${req.method} path=${req.path}`,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    res.status(401).json({ error: { code: 'ERR0007', message: 'CSRF token mismatch' } });
    return;
  }
  next();
}
