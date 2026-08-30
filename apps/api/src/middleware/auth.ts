import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

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
    res.status(401).json({ error: { code: 'ERR0002', message: 'Unauthorized' } });
    return;
  }

  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as AuthUser;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: { code: 'ERR0002', message: 'Token invalid or expired' } });
  }
}
