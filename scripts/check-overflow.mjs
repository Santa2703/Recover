#!/usr/bin/env node
/**
 * Horizontal-overflow check: loads pages in headless Chrome at several widths and reports
 * anything that scrolls sideways.
 *
 *   node scripts/check-overflow.mjs                         # every page, all widths
 *   node scripts/check-overflow.mjs /command /dashboard     # selected pages
 *
 * Env: BASE_URL (default http://localhost:3000), CHROME_PATH, WIDTHS (default 1440,1280,1024,768)
 *
 * Rules (exit code 1 when broken):
 *   >= 1024px: neither the page nor any element inside it may scroll sideways
 *   <  1024px: the page itself may not scroll sideways
 * Canvases (React Flow) and elements with data-allow-scroll are ignored.
 * Requires a running dev server.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const WIDTHS = (process.env.WIDTHS ?? '1440,1280,1024,768').split(',').map(Number);
const CHROME =
  process.env.CHROME_PATH ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find((p) =>
    fs.existsSync(p),
  );
if (!CHROME) throw new Error('Chrome not found; set CHROME_PATH');

function allPages() {
  const root = path.resolve('src/app/(workbench)');
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      // Skip legacy URLs that only redirect to a merged page (they are checked at their target).
      else if (e.name === 'page.tsx' && !/\b(redirect|legacyRedirect|redirectWithQuery)\(/.test(fs.readFileSync(p, 'utf8').slice(0, 2000))) {
        const route = '/' + path.relative(root, dir).split(path.sep).join('/');
        out.push(route.replace('[id]', 'RT-1048'));
      }
    }
  };
  walk(root);
  return out.filter((r) => r !== '/');
}

const pages = process.argv.slice(2).length ? process.argv.slice(2) : allPages();
const port = 9300 + Math.floor(Math.random() * 400);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'overflow-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(250);
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
  } catch {
    /* not up yet */
  }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

const probe = `(() => {
  const main = document.querySelector('.ant-layout-content') || document.querySelector('main') || document.body;
  const page = Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, main.scrollWidth - main.clientWidth);
  const inner = [];
  for (const el of main.querySelectorAll('*')) {
    if (el.closest('.react-flow, [data-allow-scroll]')) continue;
    const cs = getComputedStyle(el);
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.clientWidth > 0 && el.scrollWidth - el.clientWidth > 4) {
      const kind = el.closest('table, .ant-table-wrapper') || el.querySelector('table') ? 'table' : el.querySelector('[role=tab], a') && el.clientHeight < 80 ? 'tabs' : 'block';
      const label = (el.getAttribute('aria-label') || el.querySelector('h2,h3')?.textContent || '').trim().slice(0, 40);
      inner.push(kind + (label ? '(' + label + ')' : '') + ' +' + (el.scrollWidth - el.clientWidth) + 'px');
    }
  }
  return JSON.stringify({ page, inner });
})()`;

await send('Page.enable');
await send('Runtime.enable');
let failures = 0;
for (const w of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 1000, deviceScaleFactor: 1, mobile: w < 768 });
  for (const p of pages) {
    await send('Page.navigate', { url: BASE + p });
    await sleep(3000);
    // A busy dev server can return an empty probe while the page is still compiling: retry before giving up.
    let v;
    for (let attempt = 0; attempt < 5 && !v; attempt++) {
      const r = await send('Runtime.evaluate', { expression: probe, returnByValue: true });
      if (typeof r?.result?.value === 'string') v = JSON.parse(r.result.value);
      else await sleep(3000);
    }
    if (!v) {
      failures++;
      console.log(`FAIL ${w}px ${p}  page did not load`);
      continue;
    }
    const bad = v.page > 0 || (w >= 1024 && v.inner.length > 0);
    if (bad) {
      failures++;
      console.log(`FAIL ${w}px ${p}  page:+${v.page}px  ${v.inner.join('  ')}`);
    } else if (v.inner.length) {
      console.log(`ok   ${w}px ${p}  (inner scroll allowed below 1024px: ${v.inner.join('  ')})`);
    }
  }
}
console.log(`\nChecked ${pages.length} pages x ${WIDTHS.length} widths: ${failures} failure(s).`);
ws.close();
chrome.kill();
process.exit(failures ? 1 : 0);
