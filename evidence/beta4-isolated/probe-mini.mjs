// 排查：真窗口里点小窗名字后输入框为什么马上收起。记 focus / blur / visibility / resize 事件与 invoke 结果。
import { connect, sleep } from './lib.mjs';
const m = await connect(19381, 'mini');
await m.eval(`(() => { window.__probe = []; const log = (t, e) => window.__probe.push({ t, at: Math.round(performance.now()), target: e?.target?.id || e?.target?.className || String(e?.target), active: document.activeElement?.id || document.activeElement?.tagName, hasFocus: document.hasFocus() });
  for (const t of ['focusin', 'focusout', 'blur', 'focus', 'visibilitychange', 'resize']) (t === 'blur' || t === 'focus' || t === 'resize' ? window : document).addEventListener(t, e => log(t, e), true);
  const inv = window.__TAURI_INTERNALS__.invoke; window.__TAURI_INTERNALS__.invoke = (cmd, args, o) => { log('invoke:' + cmd); return inv(cmd, args, o).then(r => { log('ok:' + cmd); return r; }, e => { log('err:' + cmd + ':' + e); throw e; }); };
  return true; })()`);
await m.eval(`document.querySelector('.mini-title')?.click(), true`);
await sleep(2500);
console.log(JSON.stringify(await m.eval('window.__probe'), null, 1));
console.log(JSON.stringify(await m.eval(`({ input: !!document.querySelector('#mini-name'), pop: !!document.querySelector('.mini-pop'), cap: document.querySelector('.mini-cap')?.textContent ?? null, title: document.querySelector('.mini-title b')?.textContent })`)));
m.close(); process.exit(0);
