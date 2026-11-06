// 探针：隔离真窗口卡头有哪些按钮（只读）
import { connect } from './lib.mjs';
const page = await connect(Number(process.argv[2] ?? 19397), 'main');
console.log(await page.eval(`JSON.stringify({ head: document.querySelector('.card .c-head')?.innerText.replace(/\s+/g, ' ') ?? null, 写别的: document.body.innerText.includes('写别的'), 手动补录: document.body.innerText.includes('手动补录') })`));
page.close(); process.exit(0);
