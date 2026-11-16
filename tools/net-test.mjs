// Testet Gastgeber und Gast in zwei Tabs desselben Browsers (lokale Verbindung über BroadcastChannel).
// Aufruf: node tools/net-test.mjs <basis-url> <ausgabe-ordner>
import puppeteer from 'puppeteer-core';

const [base, outDir = '/tmp'] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=IntensiveWakeUpThrottling,CalculateNativeWinOcclusion'],
});
const mk = async (name) => {
  const p = await browser.newPage();
  await p.setViewport({ width: 874, height: 402, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: true });
  const cdp = await p.createCDPSession();
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  p.on('pageerror', (e) => console.log(`[${name} pageerror] ${e.message}`));
  p.on('console', (m) => {
    if (m.type() === 'error') console.log(`[${name} error] ${m.text()}`);
  });
  return p;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const host = await mk('host');
await host.goto(`${base}?net=local&quality=low`, { waitUntil: 'load' });
await host.waitForFunction('window.__ready === true', { timeout: 180000 });
await host.click('#m-host');
await sleep(500);
if (process.env.ARENA) await host.click('#host-arena button[data-arena=colosseum]');
const code = await host.$eval('#host-code', (e) => e.textContent);
console.log('Code:', code);

const guest = await mk('guest');
await guest.goto(`${base}?net=local&quality=low&arena=capua&room=${code}`, { waitUntil: 'load' });
await guest.waitForFunction('window.__ready === true', { timeout: 180000 });
await host.bringToFront();
await host.waitForFunction("!document.getElementById('m-host-start').disabled", { timeout: 60000 });
console.log('Lobby:', await host.$eval('#host-lobby', (e) => e.textContent));
await host.click('#m-host-start');
try {
  await host.waitForFunction("document.getElementById('menu').hidden === true", { timeout: 60000 });
} catch (e) {
  console.log('Host-Status:', await host.$eval('#host-status', (e) => e.textContent));
  console.log('Gast-Status:', await guest.$eval('#join-status', (e) => e.textContent));
  throw e;
}
await guest.waitForFunction("document.getElementById('menu').hidden === true", { timeout: 60000 });
console.log('Beide im Kampf. Rollen:', await host.evaluate('window.__game.role'), await guest.evaluate('window.__game.role'));
console.log('Arena Host/Gast:', await host.evaluate('window.__game.arenaKind'), await guest.evaluate('window.__game.arenaKind'));
if (process.env.ARENA_ONLY) {
  await guest.screenshot({ path: `${outDir}/net_arena_guest.png` });
  process.exit(0);
}

const frames = (p) => p.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else r(n); }; requestAnimationFrame(f); }));
console.log('Bilder pro Sekunde Host/Gast:', await frames(host), await frames(guest));
const state = (p) =>
  p.evaluate(() => {
    const g = window.__game;
    const f = (x) => ({ pos: [x.pos.x.toFixed(2), x.pos.z.toFixed(2)], hp: Math.round(x.g.hp), mode: x.mode, cls: x.cls });
    return JSON.stringify({ role: g.role, player: f(g.player), foe: f(g.foe) });
  });
console.log('Start  Host:', await state(host));
console.log('Start  Gast:', await state(guest));

// Gast läuft nach vorn (auf den Gastgeber zu)
await guest.evaluate(() => {
  window.__input.move.y = 0.9;
});
await sleep(4000);
await guest.evaluate(() => {
  window.__input.move.y = 0;
});
await sleep(1500);
console.log('Gelaufen Host:', await state(host));
console.log('Gelaufen Gast:', await state(guest));

// Nahkampf: beide nah zusammenstellen
await guest.evaluate(() => window.__game.player.g.root.position.set(0, 0, 0.75));
await host.evaluate(() => window.__game.player.g.root.position.set(0, 0, -0.95));
await sleep(3000);
// 1) Gastgeber blockt nicht, Gast schlägt -> Treffer am Gastgeber
await guest.evaluate(() => window.__input.push({ type: 'light' }));
await sleep(12000);
console.log('Treffer?  Host:', await state(host));
console.log('Treffer?  Gast:', await state(guest));
// 2) Gastgeber hält Block, Gast schlägt -> geblockt
await host.evaluate(() => window.__input.push({ type: 'block', on: true }));
await sleep(1500);
await guest.evaluate(() => window.__input.push({ type: 'light' }));
await sleep(12000);
console.log('Block?    Host:', await state(host));
console.log('Block?    Gast:', await state(guest));
// 3) Gastgeber lässt los und schlägt, Gast blockt nicht
await host.evaluate(() => window.__input.push({ type: 'block', on: false }));
await host.evaluate(() => window.__input.push({ type: 'light' }));
await sleep(12000);
console.log('Gast getroffen? Host:', await state(host));
console.log('Gast getroffen? Gast:', await state(guest));
await host.screenshot({ path: `${outDir}/net_host.png` });
await guest.screenshot({ path: `${outDir}/net_guest.png` });
// 4) Kampfende: der Gast gewinnt zwei Runden -> Erfahrung nur beim Gast
const xp = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('seg.hero.v1') ?? 'null'));
const before = await xp(guest);
for (let i = 0; i < 2; i++) {
  await host.evaluate(() => window.__game.kill(window.__game.player, window.__game.player.pos.subtract(window.__game.foe.pos).normalize()));
  if (i === 0) await sleep(30000);
}
await host.waitForFunction(() => !document.getElementById('result').hidden, { timeout: 400000, polling: 500 });
await guest.waitForFunction(() => !document.getElementById('result').hidden, { timeout: 120000, polling: 500 });
const res = (p) => p.evaluate(() => ({ shown: !document.getElementById('result').hidden, title: document.getElementById('r-title').textContent, lines: document.getElementById('r-lines').textContent }));
console.log('Ergebnis Host:', JSON.stringify(await res(host)));
console.log('Ergebnis Gast:', JSON.stringify(await res(guest)));
console.log('Gast-Held vorher/nachher:', JSON.stringify(before?.xp ?? 0), JSON.stringify((await xp(guest))?.level), JSON.stringify((await xp(guest))?.xp));
await guest.screenshot({ path: `${outDir}/net_guest_result.png` });
await host.click('#r-again');
await sleep(8000);
console.log('Revanche Gast:', JSON.stringify(await res(guest)), await state(guest));
await browser.close();
