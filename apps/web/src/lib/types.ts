// --- 与 backend（apps/api）响应结构严格对齐的共享类型 ---

export type AccountType = 'cash' | 'bank' | 'investment' | 'credit';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  initialBalance: number;
  currency: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  /** 实时余额（initialBalance + 净变动） */
  balance: number;
}

export type TxnType = 'income' | 'expense' | 'transfer_in' | 'transfer_out';

export interface Transaction {
  id: string;
  accountId: string;
  type: TxnType;
  amount: number;
  category: string | null;
  note: string | null;
  date: string;
  transferGroupId: string | null;
  importBatchId: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 列表接口 JOIN 附带 */
  accountName?: string | null;
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
  accountId: string;
  accountName: string;
  type: AccountType;
  initialBalance: number;
  income: number;
  expense: number;
  transferIn: number;
  transferOut: number;
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
  model: 'flash';
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
