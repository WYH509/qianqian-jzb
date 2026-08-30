-- V003__create_ai_parse_queue.sql
-- 钱钱家账本 · AI 解析队列表（PRD §13.2.6 + §9.8.3，v2 新增）

CREATE TABLE IF NOT EXISTS ai_parse_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed')),
  task_type       TEXT NOT NULL CHECK (task_type IN ('excel','bank_statement','ocr')),
  task_data       TEXT NOT NULL,
  model_attempted TEXT,
  result          TEXT,
  error_log       TEXT,
  requested_at    INTEGER NOT NULL,
  processed_at    INTEGER,
  retry_count     INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_queue_status_requested ON ai_parse_queue(status, requested_at);
CREATE INDEX IF NOT EXISTS idx_queue_type_status ON ai_parse_queue(task_type, status);