// 生成 TP-07 smoke test 用的 Excel 文件
const ExcelJS = require('exceljs');

async function generateTestExcel() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('银行流水');
  sheet.columns = [
    { header: '交易日期', key: 'date', width: 12 },
    { header: '金额', key: 'amount', width: 14 },
    { header: '类型', key: 'type', width: 10 },
    { header: '分类', key: 'category', width: 12 },
    { header: '备注', key: 'note', width: 30 },
  ];

  sheet.addRow({ date: '2026-08-25', amount: 50, type: '支出', category: '餐饮', note: '午餐' });
  sheet.addRow({ date: '2026-08-26', amount: '1,234.56', type: '支出', category: '购物', note: '超市' });
  sheet.addRow({ date: '2026/8/27', amount: '(500.00)', type: '支出', category: '交通', note: '打车' });
  sheet.addRow({ date: '2026-08-28', amount: '¥3000', type: '收入', category: '工资', note: '月薪' });
  sheet.addRow({ date: 'Aug 29, 2026', amount: -100, type: '-', category: '娱乐', note: '电影' });
  sheet.addRow({ date: '2026-08-30', amount: 88.88, type: '支出', category: '餐饮', note: '晚餐' });

  await workbook.xlsx.writeFile('/tmp/test-bank-statement.xlsx');
  console.log('✅ 生成 /tmp/test-bank-statement.xlsx');
}

generateTestExcel().catch((e) => {
  console.error(e);
  process.exit(1);
});