import { chromium } from 'playwright-core';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

await p.goto('http://localhost:8080', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1800);

console.log('sections:', await p.evaluate(() =>
  [...document.querySelectorAll('.board[data-key]')].map(s => s.dataset.key).join(' > ')));
console.log('dock ground:', await p.evaluate(() =>
  getComputedStyle(document.getElementById('consoleBody')).backgroundColor));
console.log('page ground:', await p.evaluate(() =>
  getComputedStyle(document.body).backgroundColor));

// Seed a player through the real API, then confirm the roster renders it.
await p.evaluate(async () => {
  await fetch('/api/players/access', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'Xbox_2535467890123456', list: 'admin', member: true })
  });
});
await p.waitForTimeout(600);
console.log('lists after add:', await p.evaluate(async () =>
  JSON.stringify((await (await fetch('/api/players')).json()).lists)));

await p.evaluate(async () => {
  await fetch('/api/players/access', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'Xbox_2535467890123456', list: 'admin', member: false })
  });
});
await p.waitForTimeout(400);
console.log('lists after remove:', await p.evaluate(async () =>
  JSON.stringify((await (await fetch('/api/players')).json()).lists)));

await p.screenshot({ path: 'docs/v4-desktop.png' });
console.log('overflow:', await p.evaluate(() =>
  document.documentElement.scrollWidth > window.innerWidth + 1));
console.log('errors:', errs.length ? errs : 'none');
await b.close();
