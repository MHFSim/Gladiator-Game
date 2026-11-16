// Testet das Arenaleben: Wölfe, Stier, Spießfallen, Treffer an Tieren.
// Aufruf: node tools/life-test.mjs <url> <ausgabe-ordner>
import puppeteer from 'puppeteer-core';

const [url = 'http://localhost:4173/?quality=low&weather=clear', dir = '/tmp'] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 874, height: 402, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: true });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && logs.push(`[error] ${m.text()}`));
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction('window.__ready === true', { timeout: 180000 });
await page.evaluate(() => document.getElementById('m-train').click());
await page.evaluate(() => document.querySelector('#train-mode button[data-mode=duel]').click());
await page.evaluate(() => document.querySelector('#train-list button').click());
await page.waitForFunction(() => document.getElementById('menu').hidden, { timeout: 60000 });
const G = (fn, arg) => page.evaluate(fn, arg);
const waitGame = async (sec) => {
  const t0 = await G(() => __game.now);
  await page.waitForFunction((t) => __game.now >= t, { timeout: 300000, polling: 100 }, t0 + sec);
};
const beasts = () => G(() => __game.life.beasts.map((b) => ({ k: b.kind, m: b.mode, hp: Math.round(b.hp), p: [+b.pos.x.toFixed(1), +b.pos.z.toFixed(1)], t: b.target ? __game.fighters.indexOf(b.target) : -1, clip: b.clip })));
const hp = () => G(() => __game.fighters.map((f) => Math.round(f.g.hp)));
// Gegner-KI ruhig stellen, damit nur die Tiere angreifen
await G(() => {
  const z = __game.foe.pos.scale(0);
  __game.ai.update = () => ({ dir: z, speed: 0 });
  __game.player.g.hp = 500;
  __game.foe.g.hp = 500;
});
console.log('Arenaleben an:', await G(() => __game.life.enabled));
await G(() => __game.life.spawn('wolf', 2));
await page.waitForFunction(() => __game.life.beasts.length === 2, { timeout: 60000 });
const size = await G(() => {
  const b = __game.life.beasts[0];
  const { min, max } = b.holder.getHierarchyBoundingVectors(true);
  return [+(max.x - min.x).toFixed(2), +(max.y - min.y).toFixed(2), +(max.z - min.z).toFixed(2)];
});
console.log('Wolf Größe (x,y,z):', size);
console.log('Wölfe:', JSON.stringify(await beasts()));
await waitGame(6);
console.log('Nach 6 s:', JSON.stringify(await beasts()), 'Leben', await hp());
// Kamera auf einen Wolf
await page.screenshot({ path: `${dir}/life_wolves.png` });
// Spieler schlägt zu: Wolf direkt vor ihn stellen
await G(() => {
  const p = __game.player;
  const b = __game.life.beasts.find((x) => x.alive);
  b.pos.set(p.pos.x + Math.sin(p.g.heading) * 1.3, 0, p.pos.z + Math.cos(p.g.heading) * 1.3);
  b.vel.setAll(0);
  b.mode = 'hit';
  b.modeUntil = __game.now + 1.5;
  __input.push({ type: 'light' });
});
await waitGame(1.5);
console.log('Nach Spielerschlag:', JSON.stringify(await beasts()));
// Stier
await G(() => __game.life.spawn('bull', 1));
await page.waitForFunction(() => __game.life.beasts.some((b) => b.kind === 'bull'), { timeout: 60000 });
const seen = new Set();
for (let i = 0; i < 16; i++) {
  await waitGame(0.5);
  const bs = await beasts();
  for (const b of bs) if (b.k === 'bull') seen.add(b.m);
}
console.log('Stier-Zustände:', [...seen].join(', '), 'Leben', await hp());
await page.screenshot({ path: `${dir}/life_bull.png` });
// Falle: Spieler stellt sich auf eine ruhende Platte
const ti = await G(() => {
  const i = __game.life.traps.findIndex((t) => t.state === 'idle');
  const t = __game.life.traps[i];
  __game.player.g.root.position.set(t.pos.x, 0, t.pos.z);
  __game.player.g.hp = 300;
  return i;
});
await waitGame(0.25);
const trapState = await G((i) => __game.life.traps[i].state, ti);
await waitGame(1.0);
const after = await G((i) => [__game.life.traps[i].state, Math.round(__game.player.g.hp)], ti);
console.log('Falle', ti, ':', trapState, '->', after[0], 'Spielerleben 300 ->', after[1], after[1] < 300 ? 'OK' : 'FEHLER');
await page.screenshot({ path: `${dir}/life_trap.png` });
// Ende der Runde: Tiere ziehen ab
await G(() => {
  const me = __game.player;
  __game.kill(__game.foe, __game.foe.pos.subtract(me.pos).normalize(), null, me);
});
await waitGame(3);
console.log('Nach Rundenende:', JSON.stringify(await beasts()));
console.log(logs.slice(0, 10).join('\n'));
await browser.close();
