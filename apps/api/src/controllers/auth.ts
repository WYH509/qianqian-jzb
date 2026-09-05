import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { getDb } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/error-handler.js';

// --- Zod schemas ---
export const loginSchema = {
  body: {
    username: { type: 'string' as const, minLength: 1, maxLength: 50 },
    password: { type: 'string' as const, minLength: 1, maxLength: 200 },
  },
};

// --- Helpers ---
function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function setAuthCookie(res: Response, token: string): void {
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProduction,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  });
}

function clearAuthCookie(res: Response): void {
  const isProduction = process.env.NODE_ENV === 'production';
  res.clearCookie('token', {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProduction,
  });
}

function writeAudit(
  action: 'login' | 'logout',
  userId: string,
  details?: string,
  errorCategory?: string
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_log (user_id, action, details, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    action,
    details ?? null,
    null, // ip
    null, // user_agent
    Date.now()
  );
}

// --- Login ---
export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { username, password } = req.body as { username: string; password: string };

    // Step 1: Zod validation is done by route-level middleware; just validate presence here
    if (!username || !password) {
      throw new AppError(400, 'ERR0001', 'username and password are required');
    }

    // Step 2: Check username === 'owner'
    if (username !== 'owner') {
      writeAudit('login', 'unknown', `invalid username: ${username}`, 'auth_failure');
      throw new AppError(401, 'ERR0003', 'Invalid credentials');
    }

    // Step 3: Check password === process.env.OWNER_PASSWORD
    const storedPassword = process.env.OWNER_PASSWORD;
    if (!storedPassword || password !== storedPassword) {
      writeAudit('login', 'owner', 'invalid password', 'auth_failure');
      throw new AppError(401, 'ERR0003', 'Invalid credentials');
    }

    // Step 4: Sign JWT
    const userId = 'owner';
    const jwtToken = jwt.sign({ userId }, config.JWT_SECRET, { expiresIn: '7d' });

    // Step 5: Hash JWT and write to sessions table
    const tokenHash = sha256(jwtToken);
    const sessionId = uuidv4();
    const now = Date.now();
    const expiresAt = now + 7 * 24 * 60 * 60 * 1000;

    const db = getDb();

    // Avoid UNIQUE(token_hash) collision: remove any previous session for this
    // user with the same token hash (never other devices' active sessions).
    db.prepare(
      `DELETE FROM sessions WHERE user_id = ? AND token_hash = ?`
    ).run(userId, tokenHash);

    try {
      db.prepare(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(sessionId, userId, tokenHash, expiresAt, now, now);
    } catch (err) {
      logger.error({ err, userId, sessionId }, 'Session insert failed');
      res.status(500).json({
        error: { code: 'ERR0005', message: 'Login failed due to session storage error' },
      });
      return;
    }

    // Step 6: Set cookie
    setAuthCookie(res, jwtToken);

    // TP-11 P1#3：额外种 csrf cookie（double-submit cookie 模式）。
    // httpOnly=false 因前端 JS 要读它放到 X-CSRF-Token header；登录后浏览器立即持有。
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('csrf', randomBytes(32).toString('hex'), {
      httpOnly: false,
      sameSite: 'strict',
      secure: isProduction,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    logger.info({ sessionId, userId }, 'User logged in');

    writeAudit('login', userId, `session_id=${sessionId}`);

    res.status(200).json({ ok: true, message: 'Login successful' });
  } catch (err) {
    next(err);
  }
}

// --- Logout ---
export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token =
      req.cookies?.token ||
      req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      throw new AppError(401, 'ERR0002', 'Unauthorized');
    }

    const userId = req.user?.userId ?? 'unknown';

    // Remove session from DB
    const tokenHash = sha256(token);
    const db = getDb();
    let result: { changes: number };
    try {
      result = db.prepare(
        `DELETE FROM sessions WHERE token_hash = ?`
      ).run(tokenHash);
    } catch (err) {
      logger.error({ err, userId }, 'Session delete failed');
      res.status(500).json({
        error: { code: 'ERR0005', message: 'Logout failed due to session storage error' },
      });
      return;
    }

    clearAuthCookie(res);

    if (result.changes > 0) {
      logger.info({ userId }, 'User logged out');
      writeAudit('logout', userId, 'session removed');
    } else {
      writeAudit('logout', userId, 'session not found', 'session_not_found');
    }

    res.status(200).json({ ok: true, message: 'Logout successful' });
  } catch (err) {
    next(err);
  }
}
