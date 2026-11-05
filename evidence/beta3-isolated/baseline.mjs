// 重新记一次基线（第一次记的时候 PowerShell 里没有 Get-FileHash，哈希是空的）。日常版只读。
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { baseline, here } from './lib.mjs';
const b = baseline();
await writeFile(join(here, process.argv[2] ?? 'baseline-before.json'), JSON.stringify({ ...b, takenAt: new Date().toISOString() }, null, 2));
console.log(JSON.stringify(b.daily));
