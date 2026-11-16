// Prüft die Kampfregeln: Kombo, Block, Wuchtschlag bricht Block, Parade, Schildstoß.
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://localhost:4173/?quality=low&weather=cloudy';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 874, height: 402, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && logs.push(`[error] ${m.text()}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 180000 });
await page.evaluate(() => document.getElementById('m-train').click());
await page.evaluate(() => document.querySelector('#train-list button').click());
await page.waitForFunction(() => document.getElementById('menu').hidden, { timeout: 60000 });
const G = (fn, arg) => page.evaluate(fn, arg);
const waitGame = async (sec) => {
  const t0 = await G(() => __game.now);
  await page.waitForFunction((t) => __game.now >= t, { timeout: 120000, polling: 50 }, t0 + sec);
};
// KI abschalten, Gegner vor den Spieler stellen
await G(() => {
  const z = __game.foe.pos.scale(0);
  __game.ai.update = () => ({ dir: z, speed: 0 });
  __game.ai.onFoeAttack = () => {};
  __game.player.pos.set(0, 0, 0);
  __game.foe.pos.set(0, 0, 1.7);
  __game.player.g.setHeading(0);
  __game.foe.g.setHeading(Math.PI);
});
const st = () => G(() => ({ php: Math.round(__game.player.g.hp), fhp: Math.round(__game.foe.g.hp), fst: Math.round(__game.foe.g.stamina), pm: __game.player.mode, fm: __game.foe.mode, combo: __game.player.combo }));
const reset = async () => {
  await G(() => {
    __game.player.refill();
    __game.foe.refill();
    __game.foe.setBlock(false);
    __game.player.pos.set(0, 0, 0);
    __game.foe.pos.set(0, 0, 1.7);
  });
  await waitGame(1.2);
};
const results = [];
const check = (name, ok, extra) => {
  results.push(`${ok ? 'OK ' : 'FEHLER'} ${name} ${JSON.stringify(extra)}`);
};

// 1) Kombo aus drei Schlägen
await reset();
let hits = 0;
let last = (await st()).fhp;
for (let i = 0; i < 3; i++) {
  await page.waitForFunction(() => __game.player.canAct, { timeout: 60000, polling: 30 });
  await G(() => __input.push({ type: 'light' }));
  await page.waitForFunction(() => __game.player.attack && __game.now > __game.player.attack.impactAt + 0.15, { timeout: 60000, polling: 30 });
  const s = await st();
  if (s.fhp < last) hits++;
  last = s.fhp;
}
check('Kombo: drei Treffer', hits === 3, { hits, ...(await st()) });

// 2) Block hält leichte Schläge
await reset();
await G(() => {
  __game.foe.setBlock(true);
  __game.foe.blockStart = -10;
});
let b = await st();
await G(() => __input.push({ type: 'light' }));
await waitGame(1.0);
let a = await st();
check('Block hält leichten Schlag', a.fhp === b.fhp && a.fst < b.fst && a.fm === 'block', { b, a });

// 3) Wuchtschlag bricht Block
await reset();
await G(() => {
  __game.foe.setBlock(true);
  __game.foe.blockStart = -10;
});
b = await st();
await G(() => __input.push({ type: 'heavy' }));
await page.waitForFunction(() => __game.player.attack && __game.now > __game.player.attack.impactAt + 0.1, { timeout: 60000, polling: 30 });
a = await st();
check('Wuchtschlag bricht Block', a.fhp < b.fhp && a.fm === 'stagger', { b, a });

// 4) Parade: Block frisch kurz vor dem Treffer
await reset();
await G(() => __input.push({ type: 'light' }));
await page.waitForFunction(() => __game.player.attack && __game.now >= __game.player.attack.impactAt - 0.12, { timeout: 60000, polling: 10 });
await G(() => __game.foe.setBlock(true));
await waitGame(0.4);
a = await st();
check('Parade: Angreifer wankt', a.pm === 'stagger' && a.fhp === 100, a);

// 5) Schildstoß bricht Block
await reset();
await G(() => {
  __game.foe.setBlock(true);
  __game.foe.blockStart = -10;
});
await G(() => __input.push({ type: 'bash' }));
await waitGame(0.8);
a = await st();
check('Schildstoß bricht Block', a.fm === 'stagger', a);

// 6) Spieler blockt per Taste, KI-Schlag wird geblockt
await reset();
await G(() => __input.push({ type: 'block', on: true }));
await waitGame(0.5);
const pb = await st();
await G(() => __game.foe.startAttack(false));
await waitGame(1.0);
a = await st();
check('Spieler blockt', a.php === pb.php && a.pm === 'block', { pb, a });
await G(() => __input.push({ type: 'block', on: false }));
await waitGame(0.3);
check('Block losgelassen', (await st()).pm === 'free', await st());

console.log(results.join('\n'));
console.log(logs.slice(-8).join('\n'));
await browser.close();
