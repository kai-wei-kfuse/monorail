// Headless UI prototype verification. No application process or business data is accessed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const profile = await mkdtemp(join(tmpdir(), 'monorail-032-prototype-'));
const out = resolve('../UI参考截图/0.3.2-explicit-insert');
await mkdir(out, { recursive: true });
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9339',
  `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let diagnostics = ''; chrome.stderr.on('data', bytes => { diagnostics += bytes; });
let ws;
const delay = ms => new Promise(r => setTimeout(r, ms));
try {
  let target;
  // Same startup observation window as docs/assets/readme-shots.mjs: 50 observations at 200ms.
  for (let i = 0; i < 50 && !target; i++) {
    await delay(200);
    try { target = (await (await fetch('http://127.0.0.1:9339/json')).json()).find(t => t.type === 'page'); }
    catch (error) { if (i === 49) throw new Error('Headless Chrome did not expose CDP', { cause: error }); }
  }
  if (!target) throw new Error('No headless prototype tab');
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((ok, bad) => { ws.addEventListener('open', ok, { once: true }); ws.addEventListener('error', bad, { once: true }); });
  let id = 0; const requests = new Map(), errors = [];
  ws.addEventListener('message', e => { const m = JSON.parse(String(e.data)); if (m.id && requests.has(m.id)) {
    const { ok, bad } = requests.get(m.id); requests.delete(m.id); m.error ? bad(new Error(m.error.message)) : ok(m.result);
  } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); });
  const call = (method, params = {}) => new Promise((ok, bad) => { const n = ++id; requests.set(n, { ok, bad }); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const click = selector => evaluate(`(() => { const b=document.querySelector(${JSON.stringify(selector)}); if(!b||b.disabled)throw new Error('Missing or disabled target'); b.click(); return true; })()`);


  await call('Page.enable'); await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', {width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate', {url:'http://127.0.0.1:1428/evidence/0.3.2-review-wipe.html'});
  // Match the repository's 50 x 200ms browser startup observation convention.
  for(let i=0;i<50;i++){if(await evaluate('!!document.querySelector("#start")'))break;await delay(200);}
  console.log(JSON.stringify({errors,body:await evaluate('document.body.innerText'),state:await evaluate('window.__review')})); await click('#start'); await delay(1600);
  const result = await evaluate('window.__review'); result.runtimeErrors=errors;
  await writeFile('evidence/0.3.2-review-wipe-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  assert.deepEqual(errors,[]);assert.equal(result.wipeMounts,1,'One bag start must mount the Wipe only once');
} finally { ws?.close(); chrome.kill(); }
