// Excel 解析工具集（PRD §15.3 全部算法）
// 复用：imports.ts (TP-07) + ai 解析（TP-08）

// --- 内部字段同义词表（§15.3.2） ---
export const HEADER_SYNONYMS: Record<string, string[]> = {
  date: ['日期', '交易日期', '发生日期', 'date', 'datetime', '时间', '记账日期'],
  amount: ['金额', '交易金额', 'amount', '借方金额', '支出金额', '收入金额', 'money'],
  type: ['类型', '交易类型', 'type', '收支', '收付', 'direction'],
  category: ['分类', '类别', 'category', '科目', '类目'],
  note: ['备注', '说明', 'memo', 'note', '描述', 'remark'],
};

const THRESHOLDS: Record<string, number> = {
  date: 0.8,
  amount: 0.8,
  type: 0.85,
  category: 0.7,
  note: 0.6,
};

// --- 编辑距离（Levenshtein） ---
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!;
      } else {
        const prevRow = dp[i - 1]!;
        const currRow = dp[i]!;
        dp[i]![j] =
          1 + Math.min(prevRow[j]!, currRow[j - 1]!, prevRow[j - 1]!);
      }
    }
  }
  return dp[m]![n]!;
}

/** 表头模糊匹配（§15.3.2） */
export function identifyHeader(rawHeader: string): {
  field: string | null;
  confidence: number;
} {
  const normalized = rawHeader.toLowerCase().replace(/\s+/g, '');
  let bestField: string | null = null;
  let bestConfidence = 0;
  for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
    for (const syn of synonyms) {
      const synNorm = syn.toLowerCase().replace(/\s+/g, '');
      const dist = editDistance(normalized, synNorm);
      const confidence =
        1 - dist / Math.max(normalized.length, synNorm.length);
      if (confidence > bestConfidence) {
        bestField = field;
        bestConfidence = confidence;
      }
    }
  }
  const threshold = bestField ? (THRESHOLDS[bestField] ?? 1) : 1;
  if (bestConfidence >= threshold) {
    return { field: bestField, confidence: bestConfidence };
  }
  return { field: null, confidence: bestConfidence };
}

// --- 金额解析（§15.3.3，7 种格式） ---
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === 'number') return raw;
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (s === '') return null;

  // 剥货币符号
  s = s.replace(/[¥$€£￥]/g, '').trim();

  // 括号 = 负数
  let isNegative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    isNegative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('-')) {
    isNegative = true;
    s = s.slice(1).trim();
  }

  // 欧式 vs 美式识别
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    // 都有
    if (lastComma > lastDot) {
      // 欧式：. 是千分位，, 是小数点
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // 美式：, 是千分位，. 是小数点
      s = s.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    // 只有 , ：如果 , 后正好 2 位 → 小数点；否则 → 千分位
    const afterComma = s.length - lastComma - 1;
    if (afterComma === 2 && !s.slice(lastComma + 1).includes(',')) {
      s = s.replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } // 只有 . 不动

  // 移除空格
  s = s.replace(/\s+/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;

  const num = parseFloat(s);
  if (Number.isNaN(num)) return null;
  return num * (isNegative ? -1 : 1);
}

// --- 日期解析（§15.3.4，6 种格式） ---
export function parseDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (s === '') return null;

  // Excel 序列日期（数字 → 日期）
  if (/^\d+(\.\d+)?$/.test(s) && !s.includes('-') && !s.includes('/')) {
    const n = Number(s);
    if (n > 25569 && n < 80000) {
      // Excel 序列日期：1900-01-01 = 1（注意 1900 闰年 bug，但实际项目 2000+ 无影响）
      const ms = (n - 25569) * 86400 * 1000;
      const d = new Date(ms);
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
  }

  // 2026-08-25 or 2026/8/25
  let m: RegExpMatchArray | null = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (m && m[1] && m[2] && m[3]) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  // 08/25/2026 (美式) vs 25/08/2026 (欧式) — 启发：第一个数 > 12 必欧式
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m && m[1] && m[2] && m[3]) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let month: number;
    let day: number;
    if (a > 12) {
      month = b;
      day = a;
    } else {
      month = a;
      day = b;
    }
    return `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // 2026年8月25日
  m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (m && m[1] && m[2] && m[3])
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  // Aug 25, 2026
  const MONTH_MAP: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  m = s.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && m[1] && m[2] && m[3]) {
    const monthNum = MONTH_MAP[m[1].toLowerCase().slice(0, 3)];
    if (monthNum) {
      return `${m[3]}-${String(monthNum).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    }
  }

  return null;
}

// --- 交易类型标准化（§15.3.5） ---
export type NormalizedType = 'expense' | 'income' | 'transfer_in' | 'transfer_out';

export function normalizeType(raw: unknown): NormalizedType | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (
    s === '支出' ||
    s === '付出' ||
    s === 'expense' ||
    s === '-' ||
    s === 'out' ||
    s === '支出' ||
    s === '付'
  )
    return 'expense';
  if (
    s === '收入' ||
    s === '收到' ||
    s === 'income' ||
    s === '+' ||
    s === 'in' ||
    s === '收'
  )
    return 'income';
  if (s.includes('转出') || s === 'transfer_out') return 'transfer_out';
  if (s.includes('转入') || s === 'transfer_in') return 'transfer_in';
  return null;
}

// --- SHA-256 文件 hash（用于去重） ---
import { createHash } from 'crypto';
export function sha256(buffer: Buffer | string): string {
  const h = createHash('sha256');
  h.update(buffer);
  return h.digest('hex');
}