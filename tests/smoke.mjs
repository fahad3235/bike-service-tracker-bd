'use strict';
/* Headless-Chrome smoke test via raw CDP (no puppeteer/ws deps; Node 24 WebSocket).
   Usage: node tests/smoke.mjs [width]  — default 1280. Run again with 390 for mobile. */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..');
const WIDTH = parseInt(process.argv[2] || '1280', 10);
const HEIGHT = WIDTH <= 420 ? 844 : 900;
const PORT = 9231 + (WIDTH <= 420 ? 1 : 0);
const PAGE_URL = 'file://' + path.join(ROOT, 'index.html') + '?asof=2026-10-15';

let failures = 0;
let checks = 0;
const errors = [];
function check(name, cond, extra = '') {
  checks++;
  if (cond) console.log('  PASS ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}

const chrome = spawn('/opt/meta-chromium/chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=' + PORT, '--window-size=' + WIDTH + ',' + HEIGHT, 'about:blank'
], { stdio: 'ignore' });

async function getWsUrl() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await r.json();
      const page = list.find(p => p.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('CDP did not come up');
}

const wsUrl = await getWsUrl();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve } = pending.get(msg.id);
    pending.delete(msg.id);
    resolve(msg);
  } else if (msg.method === 'Runtime.consoleAPICalled' || msg.method === 'Runtime.exceptionThrown' || msg.method === 'Log.entryAdded') {
    const text = JSON.stringify(msg.params).slice(0, 500);
    if (!text.includes('favicon')) errors.push(msg.method + ': ' + text);
  }
};
function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expression, awaitPromise = true) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.result?.result?.subtype === 'error') throw new Error('JS error: ' + r.result.result.description);
  return r.result?.result?.value;
}
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Page.navigate', { url: PAGE_URL });
await sleep(1200);

try {
  check('title renders', (await ev(`document.title`)) === 'Bike Service Tracker');
  check('4 tabs present', (await ev(`document.querySelectorAll('.tab-btn').length`)) === 4);
  check('empty state message', (await ev(`document.getElementById('bikeList').textContent.includes('No bikes yet')`)) === true);

  // Add a bike via the real form.
  await ev(`document.getElementById('tab-bikes').click()`);
  await ev(`document.getElementById('bikeName').value = 'Hero Splendor'`);
  await ev(`document.getElementById('bikeModel').value = 'iSmart 110'`);
  await ev(`document.getElementById('bikePlate').value = 'DHA-123456'`);
  await ev(`document.getElementById('bikePurchase').value = '2024-01-05'`);
  await ev(`document.getElementById('bikeOdo').value = '12500'`);
  await ev(`document.getElementById('bikeForm').dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}))`);
  await sleep(300);
  check('bike card appears', (await ev(`document.body.innerText.includes('Hero Splendor')`)) === true);
  check('bike count stat = 1', (await ev(`document.getElementById('statBikes').textContent`)) === '1');

  // Validation: empty bike name rejected inline.
  await ev(`document.getElementById('bikeName').value = ''`);
  await ev(`document.getElementById('bikeOdo').value = '12500'`);
  await ev(`document.getElementById('bikeForm').dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}))`);
  await sleep(200);
  check('empty name blocked', (await ev(`document.getElementById('bikeErr').textContent.length > 0`)) === true);
  check('still 1 bike after bad submit', (await ev(`document.getElementById('statBikes').textContent`)) === '1');

  // Log a service: engine oil @12000 -> preset next 13000 km / +60d.
  await ev(`document.getElementById('tab-services').click()`);
  await ev(`document.getElementById('svcDate').value = '2026-10-10'`);
  await ev(`document.getElementById('svcOdo').value = '12000'`);
  await ev(`document.getElementById('svcType').value = 'engine-oil'`);
  await ev(`document.getElementById('svcType').dispatchEvent(new Event('change', {bubbles:true}))`);
  check('preset next-odo autofilled 13000', (await ev(`document.getElementById('svcNextOdo').value`)) === '13000');
  check('preset next-date autofilled 2026-12-09', (await ev(`document.getElementById('svcNextDate').value`)) === '2026-12-09');
  await ev(`document.getElementById('svcGarage').value = 'Mirpur Workshop'`);
  await ev(`document.getElementById('svcCost').value = '850'`);
  await ev(`document.getElementById('svcParts').value = 'Engine oil'`);
  await ev(`document.getElementById('svcForm').dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}))`);
  await sleep(300);
  check('service total = 850.00', (await ev(`document.getElementById('statSpent').textContent`)) === '\u09F3850');
  check('history shows service', (await ev(`document.body.innerText.includes('Mirpur Workshop')`)) === true);

  // Odometer must not go backwards.
  await ev(`document.getElementById('svcOdo').value = '11000'`);
  await ev(`document.getElementById('svcCost').value = '100'`);
  await ev(`document.getElementById('svcForm').dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}))`);
  await sleep(200);
  check('backwards odo blocked', (await ev(`document.getElementById('svcErr').textContent.includes('backwards')`)) === true);
  check('still 1 service after bad submit', (await ev(`document.getElementById('statServices').textContent`)) === '1');

  // Due engine: set bike odo to 12950 -> engine-oil due in 50 km (due-soon).
  await ev(`document.getElementById('tab-dashboard').click()`);
  await sleep(200);
  check('no overdue yet', (await ev(`document.getElementById('dueList').innerText.includes('Nothing due')`)) === true);
  await ev(`localStorage.setItem('__t','x')`); // no-op, keep session warm
  const bumped = await ev(`(() => { const s = JSON.parse(localStorage.getItem('bike-service-tracker-bd-v1')); s.bikes[0].odo = 12950; localStorage.setItem('bike-service-tracker-bd-v1', JSON.stringify(s)); location.reload(); return true; })()`);
  await sleep(1200);
  check('due-soon appears at 12950', (await ev(`document.getElementById('dueList').innerText.includes('Due soon')`)) === true);
  check('due-in-50km text', (await ev(`document.getElementById('dueList').innerText.includes('due in 50 km')`)) === true);

  // BN toggle + persistence.
  await ev(`document.getElementById('langBtn').click()`);
  await sleep(200);
  check('BN title', (await ev(`document.title`)) === '\u09AC\u09BE\u0987\u0995 \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8 \u099F\u09CD\u09B0\u09CD\u09AF\u09BE\u0995\u09BE\u09B0');
  check('BN digits in stat', (await ev(`document.getElementById('statServices').textContent`)) === '\u09E7');
  await ev(`location.reload()`);
  await sleep(1200);
  check('BN persists after reload', (await ev(`document.title`)) === '\u09AC\u09BE\u0987\u0995 \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8 \u099F\u09CD\u09B0\u09CD\u09AF\u09BE\u0995\u09BE\u09B0');
  check('data persists after reload', (await ev(`document.body.innerText.includes('Hero Splendor')`)) === true);
  await ev(`document.getElementById('langBtn').click()`); // back to EN
  await sleep(200);

  // Export -> erase -> import round-trip via in-page importData.
  const exported = await ev(`(() => { const s = JSON.parse(localStorage.getItem('bike-service-tracker-bd-v1')); return JSON.stringify(s); })()`);
  check('exported JSON parses', (() => { try { JSON.parse(exported); return true; } catch (e) { return false; } })());
  await ev(`localStorage.removeItem('bike-service-tracker-bd-v1'); location.reload()`);
  await sleep(1200);
  check('wiped state is empty', (await ev(`document.getElementById('statBikes').textContent`)) === '0');
  const reimported = await ev(`(() => { const r = importData(${JSON.stringify(exported)}); if (!r.ok) return 'BAD:' + r.errors.join(','); localStorage.setItem('bike-service-tracker-bd-v1', JSON.stringify(r.state)); location.reload(); return 'OK'; })()`);
  await sleep(1200);
  check('import restores', reimported === 'OK' && (await ev(`document.getElementById('statBikes').textContent`)) === '1');

  // Malformed import rejected, data intact.
  const badImport = await ev(`(() => { const before = localStorage.getItem('bike-service-tracker-bd-v1'); const r = importData('{"version":1,"lang":"en","bikes":[],"services":[{"id":"x","bikeId":"ghost","date":"2026-01-01","odo":1,"type":"engine-oil","costPaisa":1}]}'); return r.ok ? 'ACCEPTED-BAD' : (localStorage.getItem('bike-service-tracker-bd-v1') === before ? 'REJECTED-INTACT' : 'REJECTED-CORRUPTED'); })()`);
  check('malformed import rejected, data intact', badImport === 'REJECTED-INTACT', badImport);

  // Typed-DELETE erase.
  await ev(`document.getElementById('tab-data').click()`);
  await ev(`document.getElementById('clearBtn').click()`);
  await ev(`document.getElementById('deleteInput').value = 'DELETE'`);
  await ev(`document.getElementById('clearConfirmBtn').click()`);
  await sleep(300);
  check('typed-DELETE erases all', (await ev(`document.getElementById('statBikes').textContent`)) === '0');

  // No horizontal overflow at this viewport.
  const overflow = await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`);
  check('no horizontal overflow @' + WIDTH + 'px', overflow === true);
  check('zero console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  ws.close();
  chrome.kill();
}
console.log(`\nSMOKE @${WIDTH}px: ${checks - failures}/${checks} passed`);
if (failures) { process.exitCode = 1; }
