// 排查：小窗有系统焦点时，点名字展开弹层会不会让窗口失焦（失焦 = 输入框 blur = 收起编辑）。
import { connect, sleep } from './lib.mjs';
const main = await connect(19381, 'main'), m = await connect(19381, 'mini');
// 先确保没在编辑：输入框里按 Esc
if (await m.eval(`!!document.querySelector('#mini-name')`)) { await m.eval(`document.querySelector('#mini-name').focus(), true`); await m.key('Escape'); }
await sleep(1200);
console.log('closed before', await m.eval(`!document.querySelector('#mini-name') && !!document.querySelector('.mini-title')`));
const install = `(() => { window.__probe = []; const log = (t, e) => window.__probe.push({ t, at: Math.round(performance.now()), target: e?.target?.id || e?.target?.tagName || 'window', hasFocus: document.hasFocus(), y: screenY, h: outerHeight });
  for (const t of ['focusin', 'focusout']) document.addEventListener(t, e => log(t, e), true);
  for (const t of ['blur', 'focus', 'resize']) window.addEventListener(t, e => log(t, e));
  return document.hasFocus(); })()`;
const report = async label => console.log(label, JSON.stringify(await m.eval(`({ probe: window.__probe, input: !!document.querySelector('#mini-name'), pop: !!document.querySelector('.mini-pop'), hasFocus: document.hasFocus(), title: document.querySelector('.mini-title b')?.textContent ?? null })`)));
// 1) 主窗口把焦点给小窗（同用户点了小窗）
const focused = await main.invoke('plugin:window|set_focus', { label: 'mini' }).then(() => 'ok', e => String(e));
await sleep(600);
console.log('setFocus', focused, 'hasFocus', await m.eval(install));
// 2) 真实鼠标点名字
const r = await m.rect('.mini-title');
if (r) {
  const x = r.x + r.w / 2, y = r.y + r.h / 2;
  await m.mouse('mouseMoved', x, y, 0); await m.mouse('mousePressed', x, y); await m.mouse('mouseReleased', x, y);
}
await sleep(2000);
await report('after-click');
await m.key('Escape'); await sleep(600);
main.close(); m.close(); process.exit(0);
