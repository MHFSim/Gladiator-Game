// Prüft Zerstückelung und Blut: Kopf, Arme, Bein, Wunden, Wiederherstellung.
import puppeteer from 'puppeteer-core';

const [dir = '/tmp'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 874, height: 402, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && logs.push(`[error] ${m.text()}`));
await page.goto('http://localhost:4173/?quality=low&weather=clear&time=15&view=duel', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 180000 });
await page.evaluate(() => document.getElementById('m-train').click());
await page.evaluate(() => document.querySelector('#train-list button').click());
await page.waitForFunction(() => document.getElementById('menu').hidden, { timeout: 60000 });
const waitGame = async (sec) => {
  const t0 = await page.evaluate(() => __game.now);
  await page.waitForFunction((t) => __game.now >= t, { timeout: 120000, polling: 50 }, t0 + sec);
};
await page.evaluate(() => {
  const z = __game.foe.pos.scale(0);
  __game.ai.update = () => ({ dir: z, speed: 0 });
  __game.ai.onFoeAttack = () => {};
  __game.player.pos.set(-0.3, 0, -3.4);
  __game.foe.pos.set(0.2, 0, -1.4);
});
await waitGame(0.6);
// Treffer mit Blut und Wunden
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => __input.push({ type: 'light' }));
  await waitGame(0.7);
}
await page.screenshot({ path: `${dir}/g1-hits.png` });
// Kopf ab
await page.evaluate(() => {
  const d = __game.foe.pos.subtract(__game.player.pos).normalize();
  __game.sever(__game.foe, 'head', d, 1.3);
});
await waitGame(0.35);
await page.screenshot({ path: `${dir}/g2-head.png` });
await page.evaluate(() => {
  const d = __game.foe.pos.subtract(__game.player.pos).normalize();
  __game.sever(__game.foe, 'armR', d, 1.2);
  __game.sever(__game.foe, 'legL', d, 1.0);
});
await waitGame(1.2);
await page.screenshot({ path: `${dir}/g3-limbs.png` });
await waitGame(2.5);
await page.screenshot({ path: `${dir}/g4-ground.png` });
console.log('Abgetrennt:', await page.evaluate(() => __game.foe.g.severedParts));
await page.evaluate(() => __game.gore.clear([__game.player.g, __game.foe.g]));
await waitGame(0.3);
console.log('Nach Wiederherstellung:', await page.evaluate(() => [__game.foe.g.severedParts, __game.foe.g.meshes.filter((m) => m.name === 'helmet').length]));
await page.screenshot({ path: `${dir}/g5-restored.png` });
console.log(logs.slice(-8).join('\n'));
await browser.close();
