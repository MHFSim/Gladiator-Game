// Testet Gastgeber und zwei Gäste (Gruppenkampf) in drei Tabs desselben Browsers (lokale Verbindung über BroadcastChannel).
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
const mode = process.env.MODE ?? 'melee4';
const host = await mk('host');
await host.goto(`${base}?net=local&quality=low`, { waitUntil: 'load' });
await host.waitForFunction('window.__ready === true', { timeout: 180000 });
await host.click('#m-host');
await sleep(500);
await host.select('#host-match', mode);
const code = await host.$eval('#host-code', (e) => e.textContent);
console.log('Code:', code, 'Modus:', mode);
const guests = [];
for (let i = 0; i < 2; i++) {
  const g = await mk('gast' + (i + 1));
  await g.goto(`${base}?net=local&quality=low&arena=capua&room=${code}`, { waitUntil: 'load' });
  await g.waitForFunction('window.__ready === true', { timeout: 180000 });
  guests.push(g);
}
await host.bringToFront();
await host.waitForFunction("document.querySelectorAll('#host-lobby span:not(.ai)').length >= 3", { timeout: 60000 });
console.log('Lobby:', await host.$eval('#host-lobby', (e) => e.textContent));
console.log('Gast 1 sieht:', await guests[0].$eval('#join-status', (e) => e.textContent));
await host.click('#m-host-start');
await host.waitForFunction("document.getElementById('menu').hidden === true", { timeout: 90000 });
for (const g of guests) {
  try {
    await g.waitForFunction("document.getElementById('menu').hidden === true", { timeout: 60000 });
  } catch (e) {
    for (const x of guests) console.log('Gast-Status:', await x.$eval('#join-status', (e) => e.textContent), await x.evaluate(() => window.__menu?.current));
    throw e;
  }
}
const state = (p) =>
  p.evaluate(() => {
    const g = window.__game;
    return JSON.stringify({ role: g.role, me: g.fighters.indexOf(g.player), f: g.fighters.map((x) => [x.owner.slice(0, 5), x.team, Math.round(x.g.hp), x.mode, +x.pos.x.toFixed(1), +x.pos.z.toFixed(1)]) });
  });
console.log('Start Host :', await state(host));
for (const [i, g] of guests.entries()) console.log(`Start Gast${i + 1}:`, await state(g));
// Tierhetze: der Gastgeber lässt Wölfe frei, die Gäste sehen sie
await host.evaluate(() => window.__game.life.spawn('wolf', 2));
await sleep(9000);
const bs = (p) => p.evaluate(() => JSON.stringify(window.__game.life.beasts.map((b) => [b.id, b.kind, b.mode, +b.pos.x.toFixed(1), +b.pos.z.toFixed(1), b.clip])));
console.log('Tiere Host :', await bs(host));
console.log('Tiere Gast1:', await bs(guests[0]));
await host.evaluate(() => window.__game.life.arm(window.__game.life.traps[0]));
await sleep(2500);
console.log('Falle Gast2:', await guests[1].evaluate(() => window.__game.life.traps[0].state));
await guests[0].screenshot({ path: `${outDir}/net_life_guest1.png` });
// Gast 1 läuft los
await guests[0].evaluate(() => (window.__input.move.y = 0.9));
await sleep(3000);
await guests[0].evaluate(() => (window.__input.move.y = 0));
await sleep(1500);
console.log('Gelaufen Host :', await state(host));
console.log('Gelaufen Gast2:', await state(guests[1]));
// Gast 1 steht direkt vor Gast 2 und schlägt zu
const p2 = await host.evaluate(() => {
  const g = window.__game;
  const a = g.fighters[1];
  const b = g.fighters[2];
  return [b.pos.x, b.pos.z, a.pos.x, a.pos.z];
});
await guests[0].evaluate((p) => {
  const g = window.__game;
  g.player.g.root.position.set(p[0], 0, p[1] - 1.0);
  g.player.g.setHeading(0);
}, p2);
await guests[1].evaluate(() => window.__game.player.g.setHeading(Math.PI));
await host.evaluate((p) => window.__game.fighters[1].g.root.position.set(p[0], 0, p[1] - 1.0), p2);
await sleep(1500);
await guests[0].evaluate(() => {
  window.__game.player.target = window.__game.fighters[2];
  window.__input.push({ type: 'light' });
});
await sleep(3000);
console.log('Schlag Host :', await state(host));
console.log('Schlag Gast2:', await state(guests[1]));
// Gastgeber lässt alle außer Gast 1 fallen
await host.evaluate(() => {
  const g = window.__game;
  const w = g.fighters[1];
  for (const f of g.fighters) if (f !== w && f.mode !== 'dead') g.kill(f, f.pos.subtract(w.pos).normalize(), null, w);
});
const res = async (p) => {
  await p.waitForFunction(() => !document.getElementById('result').hidden, { timeout: 120000, polling: 200 });
  return p.evaluate(() => document.getElementById('r-title').textContent + ' | ' + document.getElementById('r-sub').textContent);
};
console.log('Ergebnis Host :', await res(host));
console.log('Ergebnis Gast1:', await res(guests[0]));
console.log('Ergebnis Gast2:', await res(guests[1]));
await guests[1].screenshot({ path: `${outDir}/net_group_guest2.png` });
// Gast 2 verlässt die Arena: die KI übernimmt
await host.evaluate(() => document.getElementById('r-again').click());
await sleep(2000);
await guests[1].close();
await sleep(18000);
console.log('Nach Abgang Host:', await state(host));
await browser.close();
