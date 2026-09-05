// utils/excel-parser.ts 单元测试（PRD §15.3：金额 7 格式 / 日期 6 格式 / 表头同义词 / 类型标准化 / hash）
import { describe, it, expect } from 'vitest';
import {
  HEADER_SYNONYMS,
  identifyHeader,
  parseAmount,
  parseDate,
  normalizeType,
  sha256,
} from './excel-parser.js';

describe('parseAmount — 7 种金额格式', () => {
  it('1. 纯数字（Excel 单元格数值）', () => {
    expect(parseAmount(1234.56)).toBe(1234.56);
  });

  it('2. 带货币符号 ¥', () => {
    expect(parseAmount('¥1,234.56')).toBe(1234.56);
    expect(parseAmount('￥500')).toBe(500);
    expect(parseAmount('$100')).toBe(100);
    expect(parseAmount('€99.5')).toBe(99.5);
  });

  it('3. 美式千分位', () => {
    expect(parseAmount('1,234,567.89')).toBe(1234567.89);
    expect(parseAmount('1,234.5')).toBe(1234.5);
  });

  it('4. 欧式（点千分位 + 逗号小数点）', () => {
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('1.234.567,89')).toBe(1234567.89);
  });

  it('5. 负数括号', () => {
    expect(parseAmount('(1,234.56)')).toBe(-1234.56);
    expect(parseAmount('(50)')).toBe(-50);
  });

  it('6. 负数减号', () => {
    expect(parseAmount('-1,234.56')).toBe(-1234.56);
    expect(parseAmount('-50')).toBe(-50);
  });

  it('7. 普通字符串数字', () => {
    expect(parseAmount('1234.56')).toBe(1234.56);
    expect(parseAmount('42')).toBe(42);
  });

  it('边界：逗号后恰 2 位视作小数点', () => {
    expect(parseAmount('1,23')).toBe(1.23);
  });

  it('边界：空值 / 非法输入返回 null', () => {
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('12.34.56')).toBeNull();
  });
});

describe('parseDate — 6+ 种日期格式', () => {
  it('1. ISO YYYY-MM-DD', () => {
    expect(parseDate('2026-08-25')).toBe('2026-08-25');
  });

  it('2. 斜杠 YYYY/M/D', () => {
    expect(parseDate('2026/8/25')).toBe('2026-08-25');
    expect(parseDate('2026/08/25')).toBe('2026-08-25');
  });

  it('3. 美式 MM/DD/YYYY', () => {
    expect(parseDate('08/25/2026')).toBe('2026-08-25');
  });

  it('4. 欧式 DD/MM/YYYY（首个 > 12 判定）', () => {
    expect(parseDate('25/08/2026')).toBe('2026-08-25');
  });

  it('5. 中文年月日', () => {
    expect(parseDate('2026年8月25日')).toBe('2026-08-25');
  });

  it('6. 英文月份 Aug 25, 2026', () => {
    expect(parseDate('Aug 25, 2026')).toBe('2026-08-25');
    expect(parseDate('Dec 1, 2026')).toBe('2026-12-01');
  });

  it('7. Excel 序列日期', () => {
    // 45200 = 25569 + 19631 天 → 2023-10-01（UTC）
    expect(parseDate(45200)).toBe('2023-10-01');
    expect(parseDate('45200')).toBe('2023-10-01');
  });

  it('边界：非法 / 空值返回 null', () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate('not-a-date')).toBeNull();
    expect(parseDate('20261340')).toBeNull(); // 超大数字非 Excel 序列
  });
});

describe('identifyHeader — 表头同义词模糊匹配', () => {
  it('识别中文表头', () => {
    expect(identifyHeader('日期').field).toBe('date');
    expect(identifyHeader('交易金额').field).toBe('amount');
    expect(identifyHeader('类型').field).toBe('type');
    expect(identifyHeader('分类').field).toBe('category');
    expect(identifyHeader('备注').field).toBe('note');
  });

  it('识别英文表头', () => {
    expect(identifyHeader('date').field).toBe('date');
    expect(identifyHeader('amount').field).toBe('amount');
    expect(identifyHeader('memo').field).toBe('note');
    expect(identifyHeader('category').field).toBe('category');
  });

  it('无法识别返回 field=null', () => {
    expect(identifyHeader('完全无关的列名').field).toBeNull();
    expect(identifyHeader('').field).toBeNull();
  });

  it('HEADER_SYNONYMS 覆盖 5 个字段', () => {
    expect(Object.keys(HEADER_SYNONYMS).sort()).toEqual(
      ['date', 'amount', 'type', 'category', 'note'].sort()
    );
  });
});

describe('normalizeType — 交易类型标准化', () => {
  it('支出类', () => {
    expect(normalizeType('支出')).toBe('expense');
    expect(normalizeType('expense')).toBe('expense');
    expect(normalizeType('-')).toBe('expense');
    expect(normalizeType('out')).toBe('expense');
    expect(normalizeType('付')).toBe('expense');
  });

  it('收入类', () => {
    expect(normalizeType('收入')).toBe('income');
    expect(normalizeType('income')).toBe('income');
    expect(normalizeType('+')).toBe('income');
    expect(normalizeType('in')).toBe('income');
    expect(normalizeType('收')).toBe('income');
  });

  it('转账类', () => {
    expect(normalizeType('转出')).toBe('transfer_out');
    expect(normalizeType('transfer_out')).toBe('transfer_out');
    expect(normalizeType('转入')).toBe('transfer_in');
    expect(normalizeType('transfer_in')).toBe('transfer_in');
  });

  it('无法识别返回 null', () => {
    expect(normalizeType('其他')).toBeNull();
    expect(normalizeType(null)).toBeNull();
    expect(normalizeType(undefined)).toBeNull();
  });
});

describe('sha256', () => {
  it('稳定输出 64 位 hex', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(sha256('abc')).toHaveLength(64);
    expect(sha256('abc')).not.toBe(sha256('abd'));
  });
  it('支持 Buffer 输入', () => {
    expect(sha256(Buffer.from('abc'))).toBe(sha256('abc'));
  });
});
