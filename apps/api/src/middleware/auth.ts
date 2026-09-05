import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { config } from '../config.js';
import { getDb } from '../db/client.js';
import { writeAudit } from '../utils/audit.js';

export interface AuthUser {
  userId: string;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

declare module 'express' {
  export interface Request {
    user?: AuthUser;
  }
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const token =
    req.cookies?.token ||
    req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    writeAudit({
      action: 'login',
      userId: 'unknown',
      errorCategory: 'unauthorized_access',
      details: 'missing token',
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    res.status(401).json({ error: { code: 'ERR0002', message: 'Unauthorized' } });
    return;
  }

  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as AuthUser;
    req.user = payload;

    // TP-11 P1#2：JWT 验签通过后，还必须查 sessions 表确认 token 仍有效。
    // logout 会删除 sessions 行；若此行不存在或已过期，token 应立即失效（而非等 JWT 7d 到期）。
    const tokenHash = sha256(token);
    const session = getDb()
      .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
      .get(tokenHash) as { user_id: string; expires_at: number } | undefined;
    const now = Date.now();
    if (!session || session.expires_at < now) {
      writeAudit({
        action: 'login',
        userId: session?.user_id ?? 'unknown',
        errorCategory: 'session_expired',
        details: 'token not in sessions table or expired',
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      });
      res.status(401).json({ error: { code: 'ERR0002', message: 'Session expired or revoked' } });
      return;
    }

    // 顺手刷新 last_used_at（session 活跃度跟踪）
    getDb()
      .prepare('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?')
      .run(now, tokenHash);

    next();
  } catch {
    writeAudit({
      action: 'login',
      userId: 'unknown',
      errorCategory: 'unauthorized_access',
      details: 'invalid or expired token',
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    res.status(401).json({ error: { code: 'ERR0002', message: 'Token invalid or expired' } });
  }
}
