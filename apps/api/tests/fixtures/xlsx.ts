// 预生成测试 .xlsx（内存 buffer，不落盘），供 imports / excel-parser 测试复用
import ExcelJS from 'exceljs';

export interface XlsxRow {
  [header: string]: string | number | Date;
}

/**
 * 生成第一行表头 + 数据行的 .xlsx buffer。
 * header 顺序与 key 顺序一致，支持中文表头。
 */
export async function makeXlsxBuffer(headers: string[], rows: Array<Array<string | number>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(headers);
  for (const row of rows) {
    ws.addRow(row);
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** 标准「日期/金额/类型/分类/备注」流水表 */
export async function makeStandardStatementXlsx(): Promise<Buffer> {
  return makeXlsxBuffer(
    ['日期', '金额', '类型', '分类', '备注'],
    [
      ['2026-08-25', 50, '支出', '餐饮', '午餐'],
      ['2026-08-26', 5000, '收入', '工资', '八月工资'],
      ['2026-08-27', '¥1,234.56', '支出', '购物', ''],
    ]
  );
}

/** 表头含同义词（英文列名） */
export async function makeSynonymHeaderXlsx(): Promise<Buffer> {
  return makeXlsxBuffer(
    ['date', 'amount', 'type', 'category', 'note'],
    [
      ['2026/8/25', '100', 'income', 'bonus', '红包'],
    ]
  );
}
