import { getDb } from '../db/client.js';
import { logger } from './logger.js';

/** 删除所有已过期的 session（expires_at < now），返回删除行数。
 *  PRD §16.5 P2：expired token 不应长期滞留 sessions 表（存储 / 审计噪声 / 攻击面）。 */
export function cleanupExpiredSessions(): number {
  const db = getDb();
  const now = Date.now();
  const result = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  const count = Number(result.changes);
  if (count > 0) {
    logger.info({ count, threshold: now }, 'Session cleanup deleted expired sessions');
  }
  return count;
}
