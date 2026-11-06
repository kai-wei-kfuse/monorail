// 探针：插入时 .ins-stack 的直接子元素
import { connect, loadEnv } from './lib.mjs';
const page = await connect(19397, 'main');
console.log(JSON.stringify(await page.eval(`[...(document.querySelector('.ins-stack')?.children ?? [])].map(e => e.tagName + '.' + [...e.classList].join('.'))`)));
console.log(JSON.stringify(await page.eval(`[...document.querySelectorAll('.ins-stack .card')].map(e => [e.parentElement.className, e.className].join(' > '))`)));
page.close(); process.exit(0);
