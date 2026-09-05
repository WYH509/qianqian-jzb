import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { writeAudit } from '../utils/audit.js';

export interface AuthUser {
  userId: string;
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
  // TODO: 完整实现由 TP-03 提供（bcrypt 校验 + sessions 表验证）
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
