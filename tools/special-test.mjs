// Prüft die Sonderfähigkeiten aller Klassen und eine KI mit Netz.
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 874, height: 402, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && logs.push(`[error] ${m.text()}`));
await page.goto('http://localhost:4173/?quality=low&weather=cloudy', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 180000 });
await page.evaluate(() => document.getElementById('m-train').click());
await page.evaluate(() => document.querySelectorAll('#train-list button')[2].click());
await page.waitForFunction(() => document.getElementById('menu').hidden, { timeout: 60000 });
const waitGame = async (sec) => {
  const t0 = await page.evaluate(() => __game.now);
  await page.waitForFunction((t) => __game.now >= t, { timeout: 120000, polling: 50 }, t0 + sec);
};
await page.evaluate(() => {
  const z = __game.foe.pos.scale(0);
  __game.ai.update = () => ({ dir: z, speed: 0 });
  __game.ai.onFoeAttack = () => {};
});
for (const cls of ['murmillo', 'secutor', 'thraex', 'hoplomachus', 'retiarius', 'provocator']) {
  const r = await page.evaluate((cls) => {
    __game.setClass(__game.player, cls);
    __game.player.refill();
    __game.foe.refill();
    __game.foe.mode = 'free';
    __game.player.pos.set(0, 0, 0);
    __game.foe.pos.set(0, 0, cls === 'murmillo' ? 3 : cls === 'hoplomachus' || cls === 'retiarius' ? 5 : 1.7);
    __game.player.g.setHeading(0);
    __game.player.specialReadyAt = 0;
    __input.push({ type: 'special' });
    return 1;
  }, cls);
  await waitGame(1.6);
  if (cls === 'thraex') {
    await page.evaluate(() => {
      __game.foe.setBlock(true);
      __game.foe.blockStart = -10;
      __input.push({ type: 'light' });
    });
    await waitGame(1.0);
  }
  const s = await page.evaluate(() => ({ fhp: Math.round(__game.foe.g.hp), fm: __game.foe.mode, cd: Math.round(__game.player.specialReadyAt - __game.now), buff: __game.player.buffUntil > __game.now }));
  console.log(cls.padEnd(12), JSON.stringify(s), r);
  await page.evaluate(() => __game.foe.setBlock(false));
  await waitGame(1.0);
}
console.log(logs.slice(-8).join('\n'));
await browser.close();
