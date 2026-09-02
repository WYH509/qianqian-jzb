// --- 与 backend（apps/api）响应结构严格对齐的共享类型 ---

export type AccountType = 'cash' | 'bank' | 'investment' | 'credit';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  initial_balance: number;
  currency: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  /** 净变动（不含期初余额），实时余额接口附带 */
  net?: number;
}

export type TxnType = 'income' | 'expense' | 'transfer_in' | 'transfer_out';

export interface Transaction {
  id: string;
  account_id: string;
  type: TxnType;
  amount: number;
  category: string | null;
  note: string | null;
  date: string;
  transfer_group_id: string | null;
  import_batch_id: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  /** 列表接口 JOIN 附带 */
  account_name?: string | null;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: Pagination;
}

export interface AccountSummaryRow {
  account_id: string;
  account_name: string;
  type: AccountType;
  initial_balance: number;
  income: number;
  expense: number;
  transfer_in: number;
  transfer_out: number;
  net: number;
  balance: number;
}

export interface CashflowPoint {
  period: string;
  income: number;
  expense: number;
  net: number;
}

export type CashflowGroupBy = 'day' | 'week' | 'month' | 'quarter' | 'year';

export type QueueStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'dead_letter'
  | 'cancelled';

export interface AiParseQueueItem {
  id: string;
  filename: string;
  file_hash: string;
  status: QueueStatus;
  attempts: number;
  max_attempts: number;
  model: 'flash' | 'pro';
  error_code: string | null;
  error_message: string | null;
  result: unknown | null;
  created_at: string;
  processed_at: string | null;
}

export interface ImportPreviewRow {
  rowIndex: number;
  raw: Record<string, string>;
  parsed: {
    date: string | null;
    amount: number | null;
    type: TxnType | null;
    category: string | null;
    note: string | null;
    account_hint: string | null;
  };
  errors: string[];
}

export interface ImportPreviewResponse {
  filename: string;
  file_hash: string;
  detected_headers: string[];
  rows: ImportPreviewRow[];
  errors: string[];
}

export interface ImportHistoryItem {
  id: string;
  filename: string;
  file_hash: string;
  row_count: number;
  imported_count: number;
  skipped_count: number;
  imported_at: string;
  rolled_back_at: string | null;
}

export interface QueueStatusSummary {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  dead_letter: number;
  cancelled: number;
  next_off_peak_at: string | null;
}
