-- V001__init.sql
-- 钱钱家账本 · 数据库初始化（PRD §13.5）

-- 1. accounts
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('cash','bank','investment','credit')),
  initial_balance REAL DEFAULT 0,
  currency TEXT DEFAULT 'CNY',
  archived INTEGER DEFAULT 0 CHECK (archived IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_name_idx ON accounts(name);
CREATE INDEX IF NOT EXISTS accounts_archived_idx ON accounts(archived);

-- 2. transactions
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income','expense','transfer_in','transfer_out')),
  amount REAL NOT NULL CHECK (amount > 0),
  category TEXT,
  note TEXT,
  date TEXT NOT NULL,
  transfer_group_id TEXT,
  import_batch_id TEXT,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (import_batch_id) REFERENCES import_history(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS transactions_account_date_idx ON transactions(account_id, date, deleted_at);
CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions(date, deleted_at);
CREATE INDEX IF NOT EXISTS transactions_transfer_group_idx ON transactions(transfer_group_id);
CREATE INDEX IF NOT EXISTS transactions_import_batch_idx ON transactions(import_batch_id);

-- 3. import_history
CREATE TABLE IF NOT EXISTS import_history (
  id TEXT PRIMARY KEY,
  file_hash TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','rolled_back','failed')),
  error_message TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS import_history_file_hash_idx ON import_history(file_hash);
CREATE INDEX IF NOT EXISTS import_history_status_idx ON import_history(status, created_at);

-- 4. sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

-- 5. audit_log
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','update','delete','login','logout','export','ai_parse')),
  entity_type TEXT,
  entity_id TEXT,
  model TEXT,
  model_attempted TEXT,
  decision_path TEXT,
  error_category TEXT,
  details TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_log_user_time_idx ON audit_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log(action, created_at);

-- 6. schema_migrations（迁移追踪表）
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);