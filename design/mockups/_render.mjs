import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DIR = 'C:/Users/tiany/Desktop/Projects/AIConference2026/design/mockups';
const PORT = 9333;

const PAGES = [
  { html: 'home-desktop.html', out: 'home-desktop.png', width: 1440, mobile: false },
  { html: 'catalog-desktop.html', out: 'catalog-desktop.png', width: 1440, mobile: false },
  { html: 'home-mobile.html', out: 'home-mobile.png', width: 390, mobile: true },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// launch chrome with remote debugging
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${DIR}/_cdp_profile`,
  '--no-first-run', '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore' });

async function getBrowserWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('chrome devtools not ready');
}

function cdp(ws) {
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      listeners.forEach((l) => l(msg));
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
    });
  const on = (fn) => listeners.push(fn);
  return { send, on };
}

async function openWs(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  return ws;
}

(async () => {
  const browserWsUrl = await getBrowserWs();
  const bws = await openWs(browserWsUrl);
  const browser = cdp(bws);

  for (const p of PAGES) {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const S = (m, params) => browser.send(m, params, sessionId);

    let loaded = false;
    browser.on((msg) => { if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired') loaded = true; });

    await S('Page.enable');
    await S('Emulation.setDeviceMetricsOverride', {
      width: p.width, height: 900, deviceScaleFactor: 1, mobile: p.mobile,
    });
    await S('Page.navigate', { url: `file:///${DIR}/${p.html}` });
    for (let i = 0; i < 40 && !loaded; i++) await sleep(100);
    await sleep(3500); // let Tailwind CDN + webfonts apply and reflow

    const metrics = await S('Page.getLayoutMetrics');
    const size = metrics.cssContentSize || metrics.contentSize;
    const height = Math.ceil(size.height);

    const shot = await S('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: p.width, height, scale: 1 },
    });
    writeFileSync(`${DIR}/${p.out}`, Buffer.from(shot.data, 'base64'));
    console.log(`${p.out} ${p.width}x${height}`);
    await browser.send('Target.closeTarget', { targetId });
  }

  bws.close();
  chrome.kill();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); chrome.kill(); process.exit(1); });
