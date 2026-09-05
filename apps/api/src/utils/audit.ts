import { getDb } from '../db/client.js';

// 共享审计写入（对齐 V001__init.sql audit_log 表结构）
// action 枚举受表 CHECK 约束限制：create/update/delete/login/logout/export/ai_parse
export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'login'
  | 'logout'
  | 'export'
  | 'ai_parse';

export interface AuditEntry {
  action: AuditAction;
  userId: string;
  entityType?: string | null;
  entityId?: string | null;
  details?: unknown;
  errorCategory?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

function serializeDetails(details: unknown): string | null {
  if (details === undefined || details === null) return null;
  return typeof details === 'string' ? details : JSON.stringify(details);
}

export function writeAudit(entry: AuditEntry): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_log
       (user_id, action, entity_type, entity_id, details, error_category, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.userId,
    entry.action,
    entry.entityType ?? null,
    entry.entityId ?? null,
    serializeDetails(entry.details),
    entry.errorCategory ?? null,
    entry.ip ?? null,
    entry.userAgent ?? null,
    Date.now()
  );
}
